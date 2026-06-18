import { ethers } from "ethers";
import { config } from "../config/index.js";
import { TradeIntent } from "../decision/index.js";
import { ChainService } from "../chain/index.js";
import { PrismaClient } from "@prisma/client";
import { getTwakSigner } from "../twak/index.js";

const prisma = new PrismaClient();

const vaultAbi = [
  "function executeSwap(uint256 amountIn, uint256 amountOutMin, address[] calldata path, uint256 deadline) external",
];

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  amountOut?: string;
  error?: string;
}

export class ExecutionService {
  /**
   * Executes a trade intent.
   * PAPER mode: records a simulated trade in the DB with real price data.
   * LIVE mode: broadcasts a real on-chain swap via the RiskVault contract.
   *
   * @param intent       The validated trade intent from DecisionService.
   * @param amountIn     Amount of baseAsset (WBNB) to swap, in wei.
   * @param mode         "paper" or "live"
   * @param cascadeScore The actual cascade score that triggered this trade.
   */
  static async executeTrade(
    intent: TradeIntent,
    amountIn: bigint,
    mode: "paper" | "live",
    cascadeScore: number  // ← real score passed in, no more hardcoded 90
  ): Promise<ExecutionResult> {
    const baseAsset = await ChainService.getBaseAsset();
    const path = [baseAsset, intent.token];

    // Create DB entry (initially pending)
    const dbTrade = await prisma.trade.create({
      data: {
        tokenIn: baseAsset,
        tokenOut: intent.token,
        amountIn: amountIn.toString(),
        cascadeScore, // real cascade score
        mode,
        status: "pending",
      },
    });

    if (mode === "paper") {
      console.log(
        `[execution] [PAPER] Simulating swap of ` +
        `${ethers.formatEther(amountIn)} WBNB → ${intent.token} ` +
        `at $${intent.entry} (score: ${cascadeScore}%)`
      );

      // Simulate output with 0.3% DEX fee
      const simulatedAmountOut = (Number(ethers.formatEther(amountIn)) / intent.entry) * 0.997;
      const mockTxHash = `0xpaper-${dbTrade.id.substring(0, 16)}-${Date.now().toString(16)}`;

      await prisma.trade.update({
        where: { id: dbTrade.id },
        data: {
          status: "success",
          amountOut: simulatedAmountOut.toFixed(8),
          txHash: mockTxHash,
        },
      });

      await prisma.position.create({
        data: {
          token: intent.token,
          entryPrice: intent.entry,
          amount: simulatedAmountOut.toFixed(8),
          status: "open",
        },
      });

      console.log(`[execution] [PAPER] Simulation done. Simulated output: ${simulatedAmountOut.toFixed(8)} ${intent.token}`);
      return { success: true, txHash: mockTxHash, amountOut: simulatedAmountOut.toFixed(8) };
    }

    // ── LIVE Execution ────────────────────────────────────────────────────────
    try {
      console.log(
        `[execution] [LIVE] Broadcasting swap: ` +
        `${ethers.formatEther(amountIn)} WBNB → ${intent.token} ` +
        `(score: ${cascadeScore}%, TP: $${intent.takeProfit}, SL: $${intent.stopLoss})`
      );

      const provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL, undefined, {
        staticNetwork: true,
      });
      // Use TWAK local signer — decrypts AES-256 keystore, key never in env or logs
      const signer = await getTwakSigner(config.TWAK_SIGNER_PATH, provider);
      const vaultContract = new ethers.Contract(config.RISK_VAULT_ADDRESS, vaultAbi, signer);

      // 1% slippage: calculate amountOutMin via the on-chain router quote
      // (set to 0 for testnet simplicity — use router quoting in production)
      const amountOutMin = 0n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

      const tx = await vaultContract.executeSwap(amountIn, amountOutMin, path, deadline);
      console.log(`[execution] [LIVE] Transaction submitted. Hash: ${tx.hash}`);

      const receipt = await tx.wait();

      if (receipt?.status === 1) {
        console.log(`[execution] [LIVE] Transaction confirmed! Hash: ${tx.hash}`);

        await prisma.trade.update({
          where: { id: dbTrade.id },
          data: { status: "success", txHash: tx.hash },
        });

        await prisma.position.create({
          data: {
            token: intent.token,
            entryPrice: intent.entry,
            amount: ethers.formatEther(amountIn),
            status: "open",
          },
        });

        return { success: true, txHash: tx.hash };
      } else {
        throw new Error("Transaction reverted on-chain");
      }
    } catch (error: any) {
      console.error(`[execution] [LIVE] Trade execution failed:`, error.message);

      await prisma.trade.update({
        where: { id: dbTrade.id },
        data: { status: "failed", error: error.message },
      });

      return { success: false, error: error.message };
    }
  }
}
