"use client";

import { useEffect, useState, useRef } from "react";

interface TradePoint {
  token: string;
  date: string;
  netReturn: number;
  cumulative: number;
}

interface EquityCurveProps {
  tradesData: TradePoint[];
}

export default function EquityCurve({ tradesData }: EquityCurveProps) {
  const [pathLength, setPathLength] = useState(0);
  const pathRef = useRef<SVGPathElement>(null);
  const [hoveredPoint, setHoveredPoint] = useState<any>(null);

  useEffect(() => {
    if (pathRef.current) {
      setPathLength(pathRef.current.getTotalLength());
    }
  }, [tradesData]);

  const width = 700;
  const height = 300;
  const paddingX = 60;
  const paddingY = 40;

  if (tradesData.length <= 1) {
    return (
      <div className="flex-1 flex items-center justify-center border border-[rgba(255,255,255,0.06)] rounded bg-zinc-950 p-12 text-zinc-500 font-mono text-xs">
        No trade data to display on chart
      </div>
    );
  }

  // Get max/min values for the scale
  const cumulatives = tradesData.map((d) => d.cumulative);
  const maxVal = Math.max(15, ...cumulatives);
  const minVal = Math.min(-10, ...cumulatives);
  const valRange = maxVal - minVal;

  const getX = (index: number) => {
    return paddingX + (index / (tradesData.length - 1)) * (width - 2 * paddingX);
  };

  const getY = (val: number) => {
    return height - paddingY - ((val - minVal) / valRange) * (height - 2 * paddingY);
  };

  // Generate SVG path d string
  const svgPath = tradesData
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.cumulative)}`)
    .join(" ");

  // Benchmark line: Buy and hold benchmark is +12.1%
  const benchmarkVal = 12.1;
  const benchmarkY = getY(benchmarkVal);

  // Axis labels (Y ticks)
  // Let's create about 5 Y ticks
  const yTicks: number[] = [];
  const tickStep = valRange / 5;
  for (let i = 0; i <= 5; i++) {
    yTicks.push(Number((minVal + i * tickStep).toFixed(1)));
  }

  // X ticks: divide x range into 4-5 ticks showing date labels
  const xTicksIndices: number[] = [];
  if (tradesData.length > 2) {
    const step = Math.floor((tradesData.length - 1) / 4) || 1;
    for (let i = 0; i < tradesData.length; i += step) {
      xTicksIndices.push(i);
    }
    if (xTicksIndices[xTicksIndices.length - 1] !== tradesData.length - 1) {
      xTicksIndices.push(tradesData.length - 1);
    }
  }

  return (
    <div className="relative w-full bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
      <style>{`
        @keyframes draw-line {
          from {
            stroke-dashoffset: ${pathLength};
          }
          to {
            stroke-dashoffset: 0;
          }
        }
        .animate-draw-line {
          stroke-dasharray: ${pathLength};
          stroke-dashoffset: ${pathLength};
          animation: draw-line 1.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible select-none"
        >
          {/* Grid lines (horizontal) */}
          {yTicks.map((tickVal, i) => {
            const y = getY(tickVal);
            return (
              <g key={`y-grid-${i}`} className="opacity-20">
                <line
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="0.5"
                />
                <text
                  x={paddingX - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--cs-text-muted)"
                  className="text-[9px] font-mono"
                >
                  {tickVal >= 0 ? "+" : ""}
                  {tickVal}%
                </text>
              </g>
            );
          })}

          {/* Zero line */}
          <line
            x1={paddingX}
            y1={getY(0)}
            x2={width - paddingX}
            y2={getY(0)}
            stroke="rgba(255, 255, 255, 0.1)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Buy and hold benchmark line */}
          <line
            x1={paddingX}
            y1={benchmarkY}
            x2={width - paddingX}
            y2={benchmarkY}
            stroke="var(--cs-warm)"
            strokeWidth="1"
            strokeDasharray="4 6"
            strokeOpacity="0.75"
          />
          <text
            x={width - paddingX - 10}
            y={benchmarkY - 6}
            textAnchor="end"
            fill="var(--cs-warm)"
            className="text-[9px] font-mono opacity-80"
          >
            Buy-and-Hold Benchmark (+12.1%)
          </text>

          {/* X Axis labels (Dates) */}
          {xTicksIndices.map((idx, i) => {
            const x = getX(idx);
            const pt = tradesData[idx];
            return (
              <g key={`x-tick-${i}`}>
                <line
                  x1={x}
                  y1={height - paddingY}
                  x2={x}
                  y2={height - paddingY + 5}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="0.5"
                />
                <text
                  x={x}
                  y={height - paddingY + 18}
                  textAnchor="middle"
                  fill="var(--cs-text-muted)"
                  className="text-[9px] font-mono"
                >
                  {pt.date === "Initial" ? "Start" : pt.date}
                </text>
              </g>
            );
          })}

          {/* Equity Line (animated drawing) */}
          <path
            ref={pathRef}
            d={svgPath}
            fill="none"
            stroke="var(--cs-text-primary)"
            strokeWidth="1.75"
            strokeOpacity="0.9"
            className="animate-draw-line"
          />

          {/* Interaction nodes */}
          {tradesData.map((pt, i) => {
            const x = getX(i);
            const y = getY(pt.cumulative);
            const isHovered = hoveredPoint && hoveredPoint.idx === i;
            return (
              <g
                key={`node-${i}`}
                onMouseEnter={() => setHoveredPoint({ ...pt, idx: i, x, y })}
                onMouseLeave={() => setHoveredPoint(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={x}
                  cy={y}
                  r={isHovered ? "6" : "3.5"}
                  fill="var(--cs-bg-deep)"
                  stroke={isHovered ? "var(--cs-warm)" : "var(--cs-text-primary)"}
                  strokeWidth="1.5"
                  className="transition-all duration-150"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip display */}
      <div className="min-h-[40px] mt-4 flex items-center justify-between border-t border-zinc-900 pt-3 font-mono text-[10px] text-zinc-500">
        {hoveredPoint ? (
          <>
            <div>
              TRADE {hoveredPoint.idx}:{" "}
              <span className="text-zinc-200 font-bold">{hoveredPoint.token}</span>
            </div>
            <div>
              NET RETURN:{" "}
              <span
                className={hoveredPoint.netReturn >= 0 ? "text-emerald-400" : "text-red-500"}
              >
                {hoveredPoint.netReturn >= 0 ? "+" : ""}
                {hoveredPoint.netReturn.toFixed(2)}%
              </span>
            </div>
            <div>
              CUMULATIVE RETURN:{" "}
              <span className="text-zinc-100 font-bold">
                {hoveredPoint.cumulative.toFixed(2)}%
              </span>
            </div>
            <div>
              DATE: <span className="text-zinc-300">{hoveredPoint.date}</span>
            </div>
          </>
        ) : (
          <div className="mx-auto text-zinc-600">
            Hover over nodes along the return curve to inspect individual trade performance details.
          </div>
        )}
      </div>
    </div>
  );
}
