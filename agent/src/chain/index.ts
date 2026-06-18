import { ethers } from "ethers";
import { config } from "../config/index.js";
import { RiskState } from "../risk/index.js";

const vaultAbi = [
  "function paused() view returns (bool)",
  "function isAllowlisted(address) view returns (bool)",
  "function maxPositionBps() view returns (uint256)",
  "function dailyVolumeCap() view returns (uint256)",
  "function dailyCountCap() view returns (uint256)",
  "function dailyVolume() view returns (uint256)",
  "function dailyCount() view returns (uint256)",
  "function baseAsset() view returns (address)"
];

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)"
];

export class ChainService {
  private static provider = new ethers.JsonRpcProvider(config.BSC_RPC_URL, undefined, {
    staticNetwork: true
  });

  /**
   * Fetches the current risk state from the deployed RiskVault contract for a given token.
   */
  static async getRiskState(tokenAddress: string, mode: "paper" | "live"): Promise<RiskState> {
    if (mode === "paper" || config.RISK_VAULT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      // Return realistic mock state for paper trading
      return {
        isPaused: false,
        isTokenAllowlisted: true,
        vaultBalance: ethers.parseEther("10"), // 10 WBNB balance
        dailyVolume: ethers.parseEther("1"),
        dailyVolumeCap: ethers.parseEther("50"),
        dailyCount: 2,
        dailyCountCap: 10,
        maxPositionBps: 1000, // 10%
      };
    }

    try {
      const vaultContract = new ethers.Contract(config.RISK_VAULT_ADDRESS, vaultAbi, this.provider);

      // Read contract parameters in parallel
      const [
        isPaused,
        isTokenAllowlisted,
        maxPositionBps,
        dailyVolumeCap,
        dailyCountCap,
        dailyVolume,
        dailyCount,
        baseAsset
      ] = await Promise.all([
        vaultContract.paused(),
        vaultContract.isAllowlisted(tokenAddress),
        vaultContract.maxPositionBps(),
        vaultContract.dailyVolumeCap(),
        vaultContract.dailyCountCap(),
        vaultContract.dailyVolume(),
        vaultContract.dailyCount(),
        vaultContract.baseAsset()
      ]);

      // Read vault token balance
      const tokenContract = new ethers.Contract(baseAsset, erc20Abi, this.provider);
      const vaultBalance = await tokenContract.balanceOf(config.RISK_VAULT_ADDRESS);

      return {
        isPaused,
        isTokenAllowlisted,
        vaultBalance: BigInt(vaultBalance),
        dailyVolume: BigInt(dailyVolume),
        dailyVolumeCap: BigInt(dailyVolumeCap),
        dailyCount: Number(dailyCount),
        dailyCountCap: Number(dailyCountCap),
        maxPositionBps: Number(maxPositionBps),
      };
    } catch (error) {
      console.error("[chain] Failed to fetch on-chain risk state. Falling back to default limits:", error);
      // Fallback state to prevent the loop from crashing
      return {
        isPaused: false,
        isTokenAllowlisted: true,
        vaultBalance: ethers.parseEther("1"),
        dailyVolume: 0n,
        dailyVolumeCap: ethers.parseEther("50"),
        dailyCount: 0,
        dailyCountCap: 10,
        maxPositionBps: 1000,
      };
    }
  }

  /**
   * Helper function to get base asset address from the vault.
   */
  static async getBaseAsset(): Promise<string> {
    if (config.RISK_VAULT_ADDRESS === "0x0000000000000000000000000000000000000000") {
      return "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
    }
    try {
      const vaultContract = new ethers.Contract(config.RISK_VAULT_ADDRESS, vaultAbi, this.provider);
      return await vaultContract.baseAsset();
    } catch {
      return "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // default WBNB
    }
  }

  /**
   * Checks whether the agent EOA is registered at the official competition contract
   * on BSC Mainnet. Warns at startup if not registered.
   *
   * Competition contract: 0x212c61B9B72C95d95BF29CF032F5E5635629Aed5 (BSC Mainnet, chainId 56)
   * Registration deadline: June 25, 2026 00:00 UTC
   * To register: TWAK_WALLET_PASSWORD=<pw> node register-competition.mjs
   */
  static async checkCompetitionRegistration(): Promise<void> {
    const COMPETITION_ADDRESS = "0x212c61B9B72C95d95BF29CF032F5E5635629Aed5";
    const abi = [
      "function isRegistered(address) view returns (bool)",
      "function registrationDeadline() view returns (uint256)",
    ];
    try {
      const mainnetProvider = new ethers.JsonRpcProvider(
        "https://bsc-dataseed.binance.org", 56, { staticNetwork: true }
      );
      const contract = new ethers.Contract(COMPETITION_ADDRESS, abi, mainnetProvider);
      const [isReg, deadline] = await Promise.all([
        contract.isRegistered(config.AGENT_WALLET_ADDRESS),
        contract.registrationDeadline(),
      ]);
      const deadlineDate = new Date(Number(deadline) * 1000);
      if (isReg) {
        console.log(`[chain] ✅ Agent registered at competition contract (deadline: ${deadlineDate.toISOString()})`);
      } else {
        console.warn(`[chain] ⚠️  Agent NOT registered at competition contract!`);
        console.warn(`[chain]    Deadline: ${deadlineDate.toISOString()}`);
        console.warn(`[chain]    Fund wallet with BNB then run: node register-competition.mjs`);
      }
    } catch (err) {
      console.warn("[chain] Could not verify competition registration (mainnet RPC unreachable)");
    }
  }
}

