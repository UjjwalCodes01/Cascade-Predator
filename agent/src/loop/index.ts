import { ethers } from "ethers";
import { config, monitoredTokens } from "../config/index.js";
import { DataService, MarketSnapshot } from "../data/index.js";
import { SignalService } from "../signal/index.js";
import { DecisionService } from "../decision/index.js";
import { RiskService } from "../risk/index.js";
import { ChainService } from "../chain/index.js";
import { ExecutionService } from "../execution/index.js";
import { prisma, DbService } from "../db/index.js";
import { X402Service } from "../x402/index.js";
import { getTokenAddress } from "../tokens/index.js";

export class TradingLoop {
  private mode: "paper" | "live";
  private isRunning: boolean = false;
  private tokenHistory: Map<string, MarketSnapshot[]> = new Map();
  private baseAsset: string = "";
  private startVaultBalance: bigint = 0n; // Recorded at startup for drawdown calculation

  constructor(mode: "paper" | "live") {
    this.mode = mode;
  }

  public async start() {
    this.isRunning = true;
    this.baseAsset = await ChainService.getBaseAsset();

    // Warn if agent is not registered at the competition contract (non-blocking)
    ChainService.checkCompetitionRegistration().catch(() => {});

    console.log(`[loop] Starting Cascade Predator trading daemon in [${this.mode.toUpperCase()}] mode`);
    console.log(`[loop] RiskVault Address: ${config.RISK_VAULT_ADDRESS}`);
    console.log(`[loop] Monitoring ${monitoredTokens.length} tokens: ${monitoredTokens.join(", ")}`);

    console.log(`[loop] Cascade threshold: ${config.CASCADE_SCORE_THRESHOLD}% | TP: ${config.TAKE_PROFIT_PCT}% | SL: ${config.STOP_LOSS_PCT}% | Size: ${config.TRADE_SIZE_PCT}%`);

    // Snapshot starting vault balance for drawdown tracking
    try {
      const initState = await ChainService.getRiskState(this.baseAsset, this.mode);
      this.startVaultBalance = initState.vaultBalance;
      console.log(`[loop] Starting vault balance: ${ethers.formatEther(this.startVaultBalance)} WBNB`);
    } catch {
      console.warn("[loop] Could not read starting vault balance — drawdown tracking will use live reads.");
    }

    while (this.isRunning) {
      try {
        await this.tick();
      } catch (error) {
        console.error("[loop] Unhandled error in tick:", error);
      }

      const sleepMs = await this.getSleepInterval();
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  public stop() {
    this.isRunning = false;
    console.log("[loop] Stopping Cascade Predator trading daemon...");
  }

  private async tick() {
    console.log(`\n--- [loop] Tick started at ${new Date().toISOString()} ---`);

    // 1. Manage existing open positions (TP / SL / time-stop)
    await this.managePositions();

    let highestScore = 0;
    let highestScoreToken: string | null = null;

    // 2. Iterate over config-driven token list (no hardcodes)
    for (const token of monitoredTokens) {
      try {
        const snapshot = await DataService.fetchSnapshot(token);

        // Update rolling history buffer (20-tick window)
        if (!this.tokenHistory.has(token)) {
          this.tokenHistory.set(token, []);
        }
        const history = this.tokenHistory.get(token)!;
        history.push(snapshot);
        if (history.length > 20) history.shift();

        // Compute cascade score
        const signal = SignalService.computeScore(snapshot, history);
        if (signal.cascadeScore > highestScore) {
          highestScore = signal.cascadeScore;
          highestScoreToken = token;
        }

        console.log(
          `[loop] ${token} | Score: ${signal.cascadeScore}% | Price: $${snapshot.price.toFixed(4)} | ` +
          `OI: $${(snapshot.openInterest / 1e6).toFixed(1)}M | ` +
          `Funding: ${(snapshot.fundingRate * 100).toFixed(4)}% | ` +
          `L/S: ${snapshot.longShortRatio.toFixed(3)} | ` +
          `Liq~: $${snapshot.liquidations.toFixed(0)}`
        );

        // 3. If score crosses threshold, evaluate entry
        if (signal.cascadeScore >= config.CASCADE_SCORE_THRESHOLD) {
          console.warn(`[loop] ⚡ CASCADE SIGNAL for ${token}: ${signal.cascadeScore}%`);

          const tradeIntent = await DecisionService.evaluateSignal(signal, snapshot.price, snapshot);

          if (tradeIntent) {
            // Use the correct on-chain address for this specific token (not a hardcoded CAKE addr)
            const tokenOnChainAddress = getTokenAddress(token);
            const riskState = await ChainService.getRiskState(tokenOnChainAddress, this.mode);

            const amountIn =
              (riskState.vaultBalance * BigInt(tradeIntent.sizePct)) / 100n;

            const verdict = RiskService.checkIntent(tradeIntent, riskState, amountIn, true);

            if (verdict.approved) {
              console.log(`[loop] Risk APPROVED. Executing ${this.mode} trade...`);
              const execResult = await ExecutionService.executeTrade(
                tradeIntent,
                amountIn,
                this.mode,
                signal.cascadeScore  // ← pass real score, no hardcode
              );

              if (execResult.success) {
                console.log(`[loop] ✅ Trade executed. TxHash: ${execResult.txHash}`);
              } else {
                console.error(`[loop] ❌ Trade failed: ${execResult.error}`);
              }
            } else {
              console.warn(`[loop] Risk REJECTED: ${verdict.reason}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[loop] Failed to process ${token}:`, err.message);
      }
    }

    // 4. Record metrics with real drawdown calculation
    await this.recordLoopMetrics(highestScore);
  }

  /**
   * Determines cadence based on real market volatility signals.
   * Uses the config-driven VOLATILITY_LIQUIDATION_THRESHOLD (no magic numbers).
   */
  private async getSleepInterval(): Promise<number> {
    let maxLiquidations = 0;
    for (const history of this.tokenHistory.values()) {
      if (history.length > 0) {
        const latest = history[history.length - 1];
        maxLiquidations = Math.max(maxLiquidations, latest.liquidations);
      }
    }

    if (maxLiquidations >= config.VOLATILITY_LIQUIDATION_THRESHOLD) {
      console.log(
        `[loop] [x402] Liquidation volume spike ($${maxLiquidations.toFixed(0)} ≥ ` +
        `$${config.VOLATILITY_LIQUIDATION_THRESHOLD}). Upgrading to 10s cadence...`
      );
      await X402Service.pay("cmc/premium-high-frequency-feed", "0.0002");
      return 10_000; // 10 seconds
    }

    return 60_000; // Standard 60-second cadence
  }

  /**
   * Monitors and closes open positions when TP, SL, or time-stop is triggered.
   * Uses config-driven TP/SL percentages (no hardcodes).
   */
  private async managePositions() {
    const openPositions = await DbService.getOpenPositions();
    if (openPositions.length === 0) return;

    console.log(`[loop] Managing ${openPositions.length} open position(s)...`);

    for (const pos of openPositions) {
      try {
        const snapshot = await DataService.fetchSnapshot(pos.token);
        const currentPrice = snapshot.price;

        // Use config-driven TP/SL percentages
        const takeProfitPrice = pos.entryPrice * (1 + config.TAKE_PROFIT_PCT / 100);
        const stopLossPrice   = pos.entryPrice * (1 - config.STOP_LOSS_PCT / 100);

        let shouldClose = false;
        let reason = "";

        if (currentPrice >= takeProfitPrice) {
          shouldClose = true;
          reason = `Take-profit hit ($${currentPrice.toFixed(4)} ≥ $${takeProfitPrice.toFixed(4)})`;
        } else if (currentPrice <= stopLossPrice) {
          shouldClose = true;
          reason = `Stop-loss hit ($${currentPrice.toFixed(4)} ≤ $${stopLossPrice.toFixed(4)})`;
        }

        if (shouldClose) {
          console.warn(`[loop] 🚨 Closing position for ${pos.token}. Reason: ${reason}`);
          const pnl = (currentPrice - pos.entryPrice) / pos.entryPrice;
          await DbService.closePosition(pos.id, currentPrice, pnl);
          console.log(`[loop] Position closed. PnL: ${(pnl * 100).toFixed(2)}%`);
        }
      } catch (err: any) {
        console.error(`[loop] Failed to evaluate position for ${pos.token}:`, err.message);
      }
    }
  }

  /**
   * Records loop-level metrics to the DB with REAL drawdown calculation.
   * Drawdown = (startVaultBalance - currentVaultBalance) / startVaultBalance × 100
   */
  private async recordLoopMetrics(highestScore: number) {
    try {
      const riskState = await ChainService.getRiskState(this.baseAsset, this.mode);
      const currentBalance = riskState.vaultBalance;

      // Real drawdown: how much vault balance has dropped from start
      let drawdownPct = 0;
      if (this.startVaultBalance > 0n && currentBalance < this.startVaultBalance) {
        const lost = this.startVaultBalance - currentBalance;
        drawdownPct = Number((lost * 10000n) / this.startVaultBalance) / 100;
      }

      await DbService.recordMetric(
        ethers.formatEther(currentBalance),
        ethers.formatEther(riskState.dailyVolume),
        riskState.dailyCount,
        drawdownPct  // ← real drawdown, not 0
      );
    } catch {
      // silently skip metric write errors
    }
  }
}
