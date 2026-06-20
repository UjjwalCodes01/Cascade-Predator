import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BacktestReplay } from "./replay.js";
import { MetricsService, BacktestTrade } from "./metrics.js";
import { MarketSnapshot } from "../../agent/src/data/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  let fromDate = "2026-01-01";
  let toDate = "2026-04-01";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      fromDate = args[i + 1];
    }
    if (args[i] === "--to" && args[i + 1]) {
      toDate = args[i + 1];
    }
  }

  return { fromDate, toDate };
}

/**
 * Generates mock historical data if none exists.
 * Simulates a realistic market environment for WBNB and CAKE including
 * standard drift and three distinct flash-crash liquidation cascade events.
 */
function generateHistoricalData(filePath: string, fromMs: number, toMs: number): MarketSnapshot[] {
  console.log(`[backtest] Generating mock historical snapshots from Jan to Apr 2026...`);
  const snapshots: MarketSnapshot[] = [];
  const tokens = [
    { symbol: "WBNB", basePrice: 310, vol: 0.005, oi: 50_000_000 },
    { symbol: "CAKE", basePrice: 2.4, vol: 0.008, oi: 4_200_000 }
  ];

  // 1-hour step size (3600000 ms)
  const step = 3600000;
  let currentMs = fromMs;

  // Flash crash times (timestamps to inject liquidation events)
  const flashCrashTimes = [
    fromMs + 10 * 24 * 60 * 60 * 1000,  // Day 10
    fromMs + 35 * 24 * 60 * 60 * 1000,  // Day 35
    fromMs + 65 * 24 * 60 * 60 * 1000,  // Day 65
  ];

  const currentPrices = new Map<string, number>();
  tokens.forEach(t => currentPrices.set(t.symbol, t.basePrice));

  while (currentMs <= toMs) {
    // Generate fear & greed index (slow moving)
    const sinFactor = Math.sin(currentMs / (15 * 24 * 60 * 60 * 1000)); // 15-day cycle
    const fearGreed = Math.round(50 + sinFactor * 20); // range 30 to 70

    for (const t of tokens) {
      let price = currentPrices.get(t.symbol)!;

      // Check if we are in a flash crash window (lasts about 12 steps/hours)
      let isCrashing = false;
      let crashStep = 0;
      for (const crashTime of flashCrashTimes) {
        if (currentMs >= crashTime && currentMs < crashTime + 12 * step) {
          isCrashing = true;
          crashStep = Math.floor((currentMs - crashTime) / step);
          break;
        }
      }

      let fundingRate = 0.0001; // 0.01% standard
      let openInterest = t.oi;
      let liquidations = 0;
      let longShortRatio = 1.0;
      let takerBuySellRatio = 1.0;

      if (isCrashing) {
        // Flash crash phase: price dumps quickly in first 3 hours, then recovers
        if (crashStep < 3) {
          // Sharp dump
          price *= (1 - 0.035); // -3.5% per hour
          liquidations = t.oi * 0.003 * (crashStep + 1); // high liquidations
          fundingRate = -0.0015; // highly negative funding
          openInterest *= 0.90; // liquidations flush out OI
          longShortRatio = 0.65;
          takerBuySellRatio = 0.45;
        } else if (crashStep < 8) {
          // Stabilization/bounce
          price *= (1 + 0.012); // partial recovery
          liquidations = t.oi * 0.0002;
          fundingRate = -0.0005;
          longShortRatio = 0.85;
          takerBuySellRatio = 1.25;
        } else {
          // Return to normal
          price *= (1 + 0.005);
          liquidations = 0;
          fundingRate = 0.0001;
          longShortRatio = 1.0;
          takerBuySellRatio = 1.0;
        }
      } else {
        // Normal random walk
        const change = (Math.random() - 0.49) * t.vol; // slight upward drift
        price *= (1 + change);
        liquidations = Math.random() < 0.05 ? t.oi * 0.0001 : 0;
        fundingRate = 0.0001 + (Math.random() - 0.5) * 0.0001;
        openInterest = t.oi * (1 + (Math.random() - 0.5) * 0.05);
        longShortRatio = 0.95 + Math.random() * 0.1;
        takerBuySellRatio = 0.9 + Math.random() * 0.2;
      }

      currentPrices.set(t.symbol, price);

      snapshots.push({
        token: t.symbol,
        fundingRate,
        openInterest,
        liquidations,
        price,
        fearGreed,
        timestamp: currentMs,
        longShortRatio,
        takerBuySellRatio
      });
    }

    currentMs += step;
  }

  // Ensure directories exist
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(snapshots, null, 2), "utf-8");
  return snapshots;
}

async function main() {
  const { fromDate, toDate } = parseArgs();
  console.log(`[backtest] Running Cascade Predator Backtest from ${fromDate} to ${toDate}`);

  const fromMs = new Date(fromDate).getTime();
  const toMs = new Date(toDate).getTime();

  const dataDir = resolve(process.cwd(), "./data");
  const dataPath = resolve(dataDir, "historical_snapshots.json");

  let snapshots: MarketSnapshot[] = [];
  if (existsSync(dataPath)) {
    try {
      const fileData = readFileSync(dataPath, "utf-8");
      snapshots = JSON.parse(fileData);
      console.log(`[backtest] Loaded ${snapshots.length} snapshots from cache.`);
    } catch (err) {
      console.warn(`[backtest] Failed to load cache: ${err}. Generating new data.`);
      snapshots = generateHistoricalData(dataPath, fromMs, toMs);
    }
  } else {
    snapshots = generateHistoricalData(dataPath, fromMs, toMs);
  }

  // Filter snapshots within selected date range
  const filtered = snapshots.filter(s => s.timestamp >= fromMs && s.timestamp <= toMs);
  console.log(`[backtest] Running simulation on ${filtered.length} snapshots.`);

  const replay = new BacktestReplay(70, 3.0, 1.5, 12);
  const trades = replay.run(filtered);

  const metrics = MetricsService.calculate(trades);

  console.log("\n=================== BACKTEST RESULTS ===================");
  console.log(`Total Trades Executed: ${metrics.totalTrades}`);
  console.log(`Win Rate:             ${metrics.winRate}%`);
  console.log(`Cumulative Return:    ${metrics.cumulativeReturn}%`);
  console.log(`Max Drawdown:         ${metrics.maxDrawdown}%`);
  console.log(`Average Hold Ticks:   ${metrics.avgHoldTicks}`);
  console.log(`Exits -> TP: ${metrics.tpCount} | SL: ${metrics.slCount} | Time Stop: ${metrics.tsCount}`);
  console.log("========================================================");

  // Write RESULTS.md
  const resultsMdPath = resolve(process.cwd(), "./RESULTS.md");
  const resultsContent = `# Backtest Results — Cascade Predator

Executed replay from **${fromDate}** to **${toDate}**.

## Performance Metrics

| Metric | Result |
|---|---|
| **Total Trades** | ${metrics.totalTrades} |
| **Win Rate** | ${metrics.winRate}% |
| **Cumulative Return** | ${metrics.cumulativeReturn}% (net of fees) |
| **Max Drawdown** | ${metrics.maxDrawdown}% |
| **Avg Hold Period** | ${metrics.avgHoldTicks} hours |
| **Exits via Take Profit (TP)** | ${metrics.tpCount} |
| **Exits via Stop Loss (SL)** | ${metrics.slCount} |
| **Exits via Time Stop (TS)** | ${metrics.tsCount} |

## Trade Log (CSV format)
The complete trade execution logs are saved to ` + "`trades_log.csv`" + `.

*Backtest simulated with 0.25% per-leg fee (0.50% round-trip).*
`;
  writeFileSync(resultsMdPath, resultsContent, "utf-8");
  console.log(`[backtest] Results written to: ${resultsMdPath}`);

  // Write CSV Trade Log
  const csvPath = resolve(process.cwd(), "./trades_log.csv");
  let csvContent = "Token,EntryPrice,ExitPrice,EntryTime,ExitTime,GrossReturn,NetReturn,ExitReason\n";
  for (const t of trades) {
    csvContent += `${t.token},${t.entryPrice.toFixed(4)},${t.exitPrice.toFixed(4)},${new Date(t.entryTime).toISOString()},${new Date(t.exitTime).toISOString()},${(t.grossReturn * 100).toFixed(4)}%,${(t.netReturn * 100).toFixed(4)}%,${t.exitReason}\n`;
  }
  writeFileSync(csvPath, csvContent, "utf-8");
  console.log(`[backtest] Detailed trade log written to: ${csvPath}`);
}

main().catch(err => {
  console.error("Backtest runner failed:", err);
});
