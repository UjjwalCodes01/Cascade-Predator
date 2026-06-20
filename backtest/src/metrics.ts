export interface BacktestTrade {
  token: string;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  grossReturn: number;
  netReturn: number;
  exitReason: "TP" | "SL" | "TIME_STOP";
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  cumulativeReturn: number;
  maxDrawdown: number;
  avgHoldTicks: number;
  tpCount: number;
  slCount: number;
  tsCount: number;
}

export class MetricsService {
  static calculate(trades: BacktestTrade[]): BacktestMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        cumulativeReturn: 0,
        maxDrawdown: 0,
        avgHoldTicks: 0,
        tpCount: 0,
        slCount: 0,
        tsCount: 0,
      };
    }

    let tpCount = 0;
    let slCount = 0;
    let tsCount = 0;
    let wins = 0;
    let totalHoldTicks = 0;

    // Cumulative return calculation (assuming compounding or arithmetic?)
    // Compounding return is standard: product(1 + netReturn) - 1
    let cumulativeReturn = 1.0;
    let peak = 1.0;
    let maxDrawdown = 0.0;
    let currentEquity = 1.0;

    for (const t of trades) {
      if (t.netReturn > 0) wins++;
      if (t.exitReason === "TP") tpCount++;
      if (t.exitReason === "SL") slCount++;
      if (t.exitReason === "TIME_STOP") tsCount++;

      // Convert difference from ms to hours
      totalHoldTicks += (t.exitTime - t.entryTime) / 3600000;

      cumulativeReturn *= (1 + t.netReturn);
      
      // Track drawdown based on equity curve
      currentEquity = cumulativeReturn;
      if (currentEquity > peak) {
        peak = currentEquity;
      }
      const drawdown = (peak - currentEquity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      totalTrades: trades.length,
      winRate: parseFloat(((wins / trades.length) * 100).toFixed(2)),
      cumulativeReturn: parseFloat(((cumulativeReturn - 1) * 100).toFixed(2)),
      maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
      avgHoldTicks: parseFloat((totalHoldTicks / trades.length).toFixed(1)),
      tpCount,
      slCount,
      tsCount,
    };
  }
}
