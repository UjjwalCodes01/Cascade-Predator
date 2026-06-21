import { MarketSnapshot } from "../../agent/src/data/index.js";
import { SignalService } from "../../agent/src/signal/index.js";
import { FeeService } from "./fees.js";
import { BacktestTrade } from "./metrics.js";

export interface BacktestPosition {
  token: string;
  entryPrice: number;
  entryTime: number;
  amount: number;
  holdTicks: number;
}

export class BacktestReplay {
  private tokenHistory = new Map<string, MarketSnapshot[]>();
  private activePositions = new Map<string, BacktestPosition>();
  private completedTrades: BacktestTrade[] = [];

  constructor(
    private threshold: number = 70,
    private takeProfitPct: number = 3.0,
    private stopLossPct: number = 1.5,
    private exitTimeout: number = 12,
    private useRegimeGate: boolean = false
  ) {}

  /**
   * Run replay on historical snapshots.
   */
  run(snapshots: MarketSnapshot[]): BacktestTrade[] {
    // Clear state for clean run
    this.tokenHistory.clear();
    this.activePositions.clear();
    this.completedTrades = [];

    // Sort snapshots chronologically
    const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);

    for (const snap of sorted) {
      const token = snap.token;

      // 1. Update historical buffers for signal score calculation
      if (!this.tokenHistory.has(token)) {
        this.tokenHistory.set(token, []);
      }
      const history = this.tokenHistory.get(token)!;
      
      // Calculate score BEFORE pushing current snapshot to match live behavior of history window
      const scoreSignal = SignalService.computeScore(snap, history);
      
      history.push(snap);
      if (history.length > 20) {
        history.shift();
      }

      // 2. Manage active position if it exists
      if (this.activePositions.has(token)) {
        const pos = this.activePositions.get(token)!;
        pos.holdTicks++;

        const currentPrice = snap.price;
        const grossReturn = (currentPrice - pos.entryPrice) / pos.entryPrice;
        const returnPct = grossReturn * 100;

        let shouldExit = false;
        let exitReason: "TP" | "SL" | "TIME_STOP" = "TIME_STOP";

        if (returnPct >= this.takeProfitPct) {
          shouldExit = true;
          exitReason = "TP";
        } else if (returnPct <= -this.stopLossPct) {
          shouldExit = true;
          exitReason = "SL";
        } else if (pos.holdTicks >= this.exitTimeout) {
          shouldExit = true;
          exitReason = "TIME_STOP";
        }

        if (shouldExit) {
          const netReturn = FeeService.calculateNetReturn(pos.entryPrice, currentPrice);
          this.completedTrades.push({
            token,
            entryPrice: pos.entryPrice,
            exitPrice: currentPrice,
            entryTime: pos.entryTime,
            exitTime: snap.timestamp,
            grossReturn,
            netReturn,
            exitReason,
          });
          this.activePositions.delete(token);
        }
      } else {
        // 3. Evaluate entry signal
        if (scoreSignal.cascadeScore >= this.threshold && snap.fearGreed < 60) {
          // Check regime gate if active
          if (this.useRegimeGate) {
            const blockedRegimesStr = process.env.BLOCKED_REGIMES || "trending_up,trending_strong_up,euphoric";
            const blockedRegimes = blockedRegimesStr.split(",").map((r) => r.trim());
            const regime = snap.mcpReport?.market_regime;
            if (regime && blockedRegimes.includes(regime)) {
              continue;
            }
          }

          // Enter position
          this.activePositions.set(token, {
            token,
            entryPrice: snap.price,
            entryTime: snap.timestamp,
            amount: 1.0, // standardized size
            holdTicks: 0,
          });
        }
      }
    }

    return this.completedTrades;
  }
}
