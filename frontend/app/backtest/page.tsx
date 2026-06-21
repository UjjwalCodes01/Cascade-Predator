import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export default async function BacktestPage() {
  const backtestDir = path.resolve(process.cwd(), "../backtest");
  const resultsPath = path.join(backtestDir, "RESULTS.md");
  const csvPath = path.join(backtestDir, "trades_log.csv");

  let resultsContent = "";
  let tradesData: { token: string; date: string; netReturn: number; cumulative: number }[] = [];

  // Read RESULTS.md
  try {
    resultsContent = fs.readFileSync(resultsPath, "utf-8");
  } catch (err) {
    resultsContent = "Failed to load backtest results.";
  }

  // Parse trades_log.csv
  try {
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const lines = csvContent.trim().split("\n");
    let currentEquity = 1.0;
    
    // Start with initial point
    tradesData.push({
      token: "START",
      date: "Initial",
      netReturn: 0,
      cumulative: 0,
    });

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(",");
      if (parts.length >= 7) {
        const token = parts[0];
        const date = parts[4].split("T")[0]; // Exit date
        const netReturnStr = parts[6].replace("%", "");
        const netReturnVal = parseFloat(netReturnStr) / 100;

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
    console.error("Failed to parse trades log CSV", err);
  }

  // Render SVG Chart Points
  const width = 600;
  const height = 200;
  const padding = 40;
  let svgPath = "";
  let svgPoints: { x: number; y: number; label: string; val: string }[] = [];

  if (tradesData.length > 0) {
    const maxVal = Math.max(5, ...tradesData.map(d => d.cumulative));
    const minVal = Math.min(-5, ...tradesData.map(d => d.cumulative));
    const valRange = maxVal - minVal;

    const getX = (index: number) => {
      if (tradesData.length <= 1) return padding;
      return padding + (index / (tradesData.length - 1)) * (width - 2 * padding);
    };

    const getY = (val: number) => {
      return height - padding - ((val - minVal) / valRange) * (height - 2 * padding);
    };

    svgPath = tradesData.map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.cumulative)}`).join(" ");

    svgPoints = tradesData.map((d, i) => ({
      x: getX(i),
      y: getY(d.cumulative),
      label: `${d.token} (${d.date})`,
      val: `${d.cumulative.toFixed(2)}%`,
    }));
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold font-mono text-zinc-100">Backtest Performance</h1>
        <p className="text-sm text-zinc-400">Strategy testing across historical liquidation data</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Equity Curve Card */}
        <div className="lg:col-span-2 bg-[#0f1115] border border-zinc-800 rounded-lg p-6 flex flex-col gap-4">
          <h2 className="text-lg font-bold font-mono text-zinc-200">Cumulative Return Curve</h2>
          
          {tradesData.length <= 1 ? (
            <div className="flex-1 flex items-center justify-center border border-zinc-850 rounded bg-zinc-950 p-12 text-zinc-500 font-mono text-sm">
              No trade data to display on chart
            </div>
          ) : (
            <div className="bg-zinc-950 border border-zinc-850 rounded p-4 flex justify-center">
              <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
                {/* Zero line */}
                {tradesData.length > 0 && (
                  <line 
                    x1={padding} 
                    y1={height - padding - ((-Math.min(-5, ...tradesData.map(d => d.cumulative)) / (Math.max(5, ...tradesData.map(d => d.cumulative)) - Math.min(-5, ...tradesData.map(d => d.cumulative)))) * (height - 2 * padding))}
                    x2={width - padding}
                    y2={height - padding - ((-Math.min(-5, ...tradesData.map(d => d.cumulative)) / (Math.max(5, ...tradesData.map(d => d.cumulative)) - Math.min(-5, ...tradesData.map(d => d.cumulative)))) * (height - 2 * padding))}
                    stroke="#27272a"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                )}
                {/* Equity Line */}
                <path d={svgPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" />
                {/* Points */}
                {svgPoints.map((pt, i) => (
                  <g key={i} className="group">
                    <circle cx={pt.x} cy={pt.y} r="5" fill="#0f1115" stroke="#f59e0b" strokeWidth="2.5" />
                    <text
                      x={pt.x}
                      y={pt.y - 12}
                      textAnchor="middle"
                      fill="#f3f4f6"
                      className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 px-1 py-0.5 rounded pointer-events-none"
                    >
                      {pt.label}: {pt.val}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          )}
          <p className="text-xs text-zinc-500 font-mono">Hover over the nodes on the equity line to inspect transaction results.</p>
        </div>

        {/* Overview Markdown Metrics Card */}
        <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6 flex flex-col gap-4">
          <h2 className="text-lg font-bold font-mono text-zinc-200">Historical Findings</h2>
          <div className="flex-1 overflow-y-auto max-h-[300px] border border-zinc-850 rounded bg-zinc-950 p-4 font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
            {resultsContent}
          </div>
        </div>
      </div>
    </div>
  );
}
