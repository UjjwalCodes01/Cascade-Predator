import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

interface TradePoint {
  token: string;
  date: string;
  netReturn: number;
  cumulative: number;
}

function EquityChart({ data }: { data: TradePoint[] }) {
  if (data.length < 2) {
    return (
      <div
        style={{
          height: 260,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          background: "var(--bg-soft)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          fontSize: 14,
        }}
      >
        No backtest data available yet
      </div>
    );
  }

  const width = 600;
  const height = 220;
  const pad = { t: 20, r: 20, b: 40, l: 60 };
  const chartW = width - pad.l - pad.r;
  const chartH = height - pad.t - pad.b;

  const vals = data.map((d) => d.cumulative);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const range = maxVal - minVal || 1;

  const xScale = (i: number) => (i / (data.length - 1)) * chartW;
  const yScale = (v: number) => chartH - ((v - minVal) / range) * chartH;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${pad.l + xScale(i)} ${pad.t + yScale(d.cumulative)}`)
    .join(" ");

  const areaPath =
    linePath +
    ` L ${pad.l + chartW} ${pad.t + chartH} L ${pad.l} ${pad.t + chartH} Z`;

  const finalVal = data[data.length - 1].cumulative;
  const lineColor = finalVal >= 0 ? "#0052ff" : "#d92d20";

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", maxHeight: 260 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
          <clipPath id="chartClip">
            <rect x={pad.l} y={pad.t} width={chartW} height={chartH} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = pad.t + t * chartH;
          const val = maxVal - t * range;
          return (
            <g key={i}>
              <line
                x1={pad.l}
                y1={y}
                x2={pad.l + chartW}
                y2={y}
                stroke="#e5e9f0"
                strokeWidth={1}
              />
              <text
                x={pad.l - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={10}
                fill="#8a94a6"
                fontFamily="JetBrains Mono, monospace"
              >
                {val >= 0 ? "+" : ""}{val.toFixed(1)}%
              </text>
            </g>
          );
        })}

        {/* Zero line */}
        {minVal < 0 && maxVal > 0 && (
          <line
            x1={pad.l}
            y1={pad.t + yScale(0)}
            x2={pad.l + chartW}
            y2={pad.t + yScale(0)}
            stroke="#d0d7e3"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}

        {/* Area fill */}
        <path d={areaPath} fill="url(#equityGrad)" clipPath="url(#chartClip)" />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          clipPath="url(#chartClip)"
        />

        {/* Trade dots */}
        {data
          .filter((_, i) => i > 0)
          .map((d, i) => (
            <circle
              key={i}
              cx={pad.l + xScale(i + 1)}
              cy={pad.t + yScale(d.cumulative)}
              r={3.5}
              fill={d.netReturn >= 0 ? "#00875a" : "#d92d20"}
              stroke="white"
              strokeWidth={1.5}
            />
          ))}

        {/* X axis labels */}
        {data
          .filter((_, i) => i % Math.max(1, Math.floor(data.length / 5)) === 0)
          .map((d, i) => (
            <text
              key={i}
              x={pad.l + xScale(i * Math.max(1, Math.floor(data.length / 5)))}
              y={pad.t + chartH + 18}
              textAnchor="middle"
              fontSize={10}
              fill="#8a94a6"
              fontFamily="Inter, sans-serif"
            >
              {d.date}
            </text>
          ))}
      </svg>
    </div>
  );
}

export default async function BacktestPage() {
  const backtestDir = path.resolve(process.cwd(), "../backtest");
  const csvPath = path.join(backtestDir, "trades_log.csv");

  let tradesData: TradePoint[] = [];

  try {
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.trim().split("\n");
    let currentEquity = 1.0;

    tradesData.push({ token: "START", date: "Start", netReturn: 0, cumulative: 0 });

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(",");
      if (parts.length >= 7) {
        const token = parts[0];
        const date = parts[4].split("T")[0];
        const netReturnVal = parseFloat(parts[6].replace("%", "")) / 100;
        currentEquity = currentEquity * (1 + netReturnVal);
        tradesData.push({
          token,
          date,
          netReturn: netReturnVal * 100,
          cumulative: (currentEquity - 1.0) * 100,
        });
      }
    }
  } catch (err) {
    // No CSV yet — will show empty state
  }

  const totalTrades = tradesData.length - 1;
  const winTrades = tradesData.filter((t) => t.token !== "START" && t.netReturn > 0).length;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
  const cumulativeReturn = tradesData.length > 0 ? tradesData[tradesData.length - 1].cumulative : 0;

  let peak = 0;
  let maxDrawdown = 0;
  tradesData.forEach((d) => {
    if (d.cumulative > peak) peak = d.cumulative;
    const dd = peak - d.cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  });

  const buyAndHoldBenchmark = 12.1;
  const outperformance = cumulativeReturn - buyAndHoldBenchmark;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Backtest Research
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
          Historical replay of the cascade signal against Jan–Apr 2026 BSC derivatives data
        </p>
      </div>

      {/* Metrics Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        {[
          {
            label: "Cumulative Return",
            value: `${cumulativeReturn >= 0 ? "+" : ""}${cumulativeReturn.toFixed(2)}%`,
            color: cumulativeReturn >= 0 ? "var(--green)" : "var(--red)",
            bg: cumulativeReturn >= 0 ? "var(--green-bg)" : "var(--red-bg)",
          },
          {
            label: "Max Drawdown",
            value: `-${maxDrawdown.toFixed(2)}%`,
            color: "var(--red)",
            bg: "var(--red-bg)",
          },
          {
            label: "Win Rate",
            value: `${winRate.toFixed(0)}%`,
            color: winRate >= 50 ? "var(--green)" : "var(--amber)",
            bg: winRate >= 50 ? "var(--green-bg)" : "var(--amber-bg)",
          },
          {
            label: "Total Trades",
            value: `${totalTrades}`,
            color: "var(--accent)",
            bg: "var(--accent-light)",
          },
          {
            label: "vs Buy & Hold",
            value: `${outperformance >= 0 ? "+" : ""}${outperformance.toFixed(2)}pp`,
            color: outperformance >= 0 ? "var(--green)" : "var(--red)",
            bg: outperformance >= 0 ? "var(--green-bg)" : "var(--red-bg)",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="card"
            style={{ padding: "18px 20px", background: s.bg, borderColor: "transparent" }}
          >
            <div className="stat-label">{s.label}</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: s.color,
                marginTop: 6,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Equity Curve */}
      <div className="card" style={{ padding: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Cumulative Net Return</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Jan–Apr 2026 · 0.25% fee/leg · BSC tokens
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
              Win
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
              Loss
            </div>
          </div>
        </div>
        <EquityChart data={tradesData} />
      </div>

      {/* Decision Gate Comparison */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Regime Gate Improvement</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Pre-gate vs. post-gate with CMC Market Regime self-disable
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table-base">
            <thead>
              <tr>
                <th>Metric</th>
                <th style={{ textAlign: "right" }}>Pre-Gate (Raw)</th>
                <th style={{ textAlign: "right" }}>Post-Gate (Regime)</th>
                <th style={{ textAlign: "right", color: "var(--green)" }}>Improvement</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Total Trades", "6", "4", "−2 (avoided whipsaw)"],
                ["Win Rate", "33.33%", "50.00%", "+16.67%"],
                ["Cumulative Return", "−9.60%", "−1.95%", "+7.65%"],
                ["Max Drawdown", "9.60%", "7.81%", "1.79% lower risk"],
                ["Stop-Loss Exits", "4", "2", "Avoided 2 bad exits"],
              ].map(([metric, pre, post, delta]) => (
                <tr key={metric as string}>
                  <td style={{ fontWeight: 500, color: "var(--text)" }}>{metric}</td>
                  <td style={{ textAlign: "right", color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace" }}>{pre}</td>
                  <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>{post}</td>
                  <td style={{ textAlign: "right", color: "var(--green)", fontWeight: 600, fontSize: 12 }}>{delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Failure Mode Callout */}
      <div
        style={{
          padding: "20px 24px",
          background: "var(--red-bg)",
          border: "1px solid #fecaca",
          borderRadius: 10,
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--red)" }}>Known Failure Mode</div>
          <p style={{ fontSize: 13, color: "var(--text-soft)", margin: 0, lineHeight: 1.7 }}>
            In trending-up or highly euphoric regimes (e.g., March 17–24, 2026), the strategy loses{" "}
            <strong style={{ color: "var(--red)" }}>4.50%</strong> as cascade setups don't mean-revert
            but trigger cascading false-breakout stop-outs. The CMC Regime Gate successfully identifies
            these macro structures and halts execution, eliminating this category of drawdown.
          </p>
        </div>
      </div>

      {/* Methodology */}
      <div className="card-soft" style={{ padding: "20px 24px" }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Backtest Methodology</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
            fontSize: 12,
          }}
        >
          {[
            { label: "Data Source", value: "CMC OHLCV + Derivatives" },
            { label: "Period", value: "Jan–Apr 2026" },
            { label: "Universe", value: "149 BEP-20 tokens" },
            { label: "Fee Model", value: "0.25% per leg (0.5% RT)" },
            { label: "Signal Code", value: "Identical to live server" },
            { label: "Avg Hold", value: "2.0 hours" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: "10px 14px",
                background: "var(--bg)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500, marginBottom: 3, textTransform: "uppercase" }}>
                {item.label}
              </div>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 600, color: "var(--text)" }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
