"use client";

import { useEffect, useState } from "react";

interface RecentSnapshot {
  id: string;
  token: string;
  cascadeScore: number;
  liquidationIntensity: number;
  priceDeviation: number;
  fundingStress: number;
  fearGreed: number;
  regimeGateBlocked: boolean;
  timestamp: string;
}

const TOKENS = ["WBNB", "CAKE", "FLOKI", "TWT", "PENDLE"];

function MiniRing({ score }: { score: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ - (circ * Math.min(100, score)) / 100;
  const color = score >= 70 ? "#0052ff" : score >= 40 ? "#b45309" : "#d0d7e3";

  return (
    <svg width={56} height={56} viewBox="0 0 56 56">
      <circle cx={28} cy={28} r={r} fill="none" stroke="#f1f3f7" strokeWidth={5} />
      <circle
        cx={28}
        cy={28}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text
        x={28}
        y={28}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={13}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
        fill={color}
      >
        {Math.round(score)}
      </text>
    </svg>
  );
}

function ComponentBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 5, background: "#f1f3f7", borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            width: `${(value / max) * 100}%`,
            height: "100%",
            background: color,
            borderRadius: 10,
            transition: "width 0.5s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
          fontWeight: 600,
          color: "var(--text-soft)",
          minWidth: 28,
          textAlign: "right",
        }}
      >
        {value.toFixed(0)}
      </span>
    </div>
  );
}

export default function ScannerPage() {
  const [snapshots, setSnapshots] = useState<RecentSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "high">("all");

  const fetchData = async () => {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.recentSnapshots || []);
        setAsOf(data.asOf);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, []);

  const byToken = snapshots.reduce((acc, s) => {
    if (!acc[s.token]) acc[s.token] = s;
    return acc;
  }, {} as Record<string, RecentSnapshot>);

  let tokenList = TOKENS.map((t) => byToken[t] ?? {
    id: t,
    token: t,
    cascadeScore: 0,
    liquidationIntensity: 0,
    priceDeviation: 0,
    fundingStress: 0,
    fearGreed: 50,
    regimeGateBlocked: false,
    timestamp: new Date().toISOString(),
  });

  if (filter === "active") tokenList = tokenList.filter((t) => t.cascadeScore >= 40);
  if (filter === "high") tokenList = tokenList.filter((t) => t.cascadeScore >= 70);

  tokenList = [...tokenList].sort((a, b) => b.cascadeScore - a.cascadeScore);

  const totalSignaling = tokenList.filter((t) => t.cascadeScore >= 70).length;
  const totalBuilding = tokenList.filter((t) => t.cascadeScore >= 40 && t.cascadeScore < 70).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }} className="animate-fade-up">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Token Scanner
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
            Live cascade score monitoring across all supported BSC tokens
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {asOf && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ↻ Live · {new Date(asOf).toLocaleTimeString()}
            </span>
          )}
          <div className="live-dot" />
        </div>
      </div>

      {/* Summary chips */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          {
            label: `${totalSignaling} High Signal`,
            color: "var(--accent)",
            bg: "var(--accent-light)",
          },
          {
            label: `${totalBuilding} Building`,
            color: "var(--amber)",
            bg: "var(--amber-bg)",
          },
          {
            label: `${tokenList.length - totalSignaling - totalBuilding} Quiet`,
            color: "var(--text-muted)",
            bg: "var(--bg-muted)",
          },
        ].map((chip) => (
          <div
            key={chip.label}
            style={{
              padding: "6px 14px",
              background: chip.bg,
              color: chip.color,
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {chip.label}
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "var(--bg-muted)",
          padding: 4,
          borderRadius: 10,
          width: "fit-content",
        }}
      >
        {(["all", "active", "high"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              background: filter === f ? "var(--bg)" : "transparent",
              color: filter === f ? "var(--text)" : "var(--text-muted)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: filter === f ? "var(--shadow-sm)" : "none",
              transition: "all 0.15s",
            }}
          >
            {f === "all" ? "All Tokens" : f === "active" ? "Building (40+)" : "High Signal (70+)"}
          </button>
        ))}
      </div>

      {/* Token Grid */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="animate-shimmer" style={{ height: 220, borderRadius: 10 }} />
          ))}
        </div>
      ) : tokenList.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📡</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No tokens match this filter</div>
          <div style={{ fontSize: 13 }}>Try switching to "All Tokens"</div>
        </div>
      ) : (
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}
        >
          {tokenList.map((snap) => {
            const score = snap.cascadeScore;
            const isHigh = score >= 70;
            const isMid = score >= 40;

            return (
              <div
                key={snap.token}
                className="card"
                style={{
                  padding: "20px 22px",
                  borderColor: isHigh ? "#bfdbfe" : isMid ? "#fde68a" : "var(--border)",
                  borderWidth: isHigh ? 1.5 : 1,
                  position: "relative",
                  overflow: "hidden",
                  transition: "box-shadow 0.2s",
                }}
              >
                {/* Top accent line */}
                {isHigh && (
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      background: "linear-gradient(90deg, #0052ff, #7c3aed)",
                    }}
                  />
                )}

                {/* Header row */}
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
                      {snap.token}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      BSC · {new Date(snap.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <MiniRing score={score} />
                </div>

                {/* Signal status */}
                <div style={{ marginBottom: 16 }}>
                  <span
                    className={`badge ${isHigh ? "badge-blue" : isMid ? "badge-amber" : "badge-gray"}`}
                  >
                    {isHigh ? "🔥 Signal Ready" : isMid ? "⚡ Building" : "● Quiet"}
                  </span>
                  {snap.regimeGateBlocked && (
                    <span className="badge badge-amber" style={{ marginLeft: 6 }}>
                      ⏸ Regime Blocked
                    </span>
                  )}
                </div>

                {/* Component bars */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      <span>Liquidation Intensity</span>
                      <span style={{ color: "var(--text-soft)" }}>max 40</span>
                    </div>
                    <ComponentBar value={snap.liquidationIntensity} max={40} color="#0052ff" />
                  </div>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      <span>Price Deviation</span>
                      <span style={{ color: "var(--text-soft)" }}>max 40</span>
                    </div>
                    <ComponentBar value={snap.priceDeviation} max={40} color="#7c3aed" />
                  </div>
                  <div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginBottom: 4,
                        fontWeight: 500,
                      }}
                    >
                      <span>Funding Stress</span>
                      <span style={{ color: "var(--text-soft)" }}>max 20</span>
                    </div>
                    <ComponentBar value={snap.fundingStress} max={20} color="#b45309" />
                  </div>
                </div>

                {/* Footer */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ color: "var(--text-muted)" }}>
                    Fear & Greed:{" "}
                    <strong
                      style={{
                        color:
                          snap.fearGreed < 40
                            ? "var(--red)"
                            : snap.fearGreed > 60
                            ? "var(--green)"
                            : "var(--text)",
                      }}
                    >
                      {snap.fearGreed}
                    </strong>
                  </div>
                  <div
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                      fontWeight: 700,
                      fontSize: 13,
                      color: isHigh ? "var(--accent)" : isMid ? "var(--amber)" : "var(--text-muted)",
                    }}
                  >
                    Score: {score}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Score Threshold Legend */}
      <div
        className="card-soft"
        style={{ padding: "16px 20px", display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>SCORE THRESHOLDS</span>
        {[
          { range: "0–39", label: "Quiet — No signal", color: "var(--text-muted)" },
          { range: "40–69", label: "Building — Cascade forming", color: "var(--amber)" },
          { range: "70–100", label: "High — Signal threshold met", color: "var(--accent)" },
        ].map((t) => (
          <div key={t.range} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: t.color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 700, color: t.color }}>
              {t.range}
            </span>
            <span style={{ color: "var(--text-soft)" }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
