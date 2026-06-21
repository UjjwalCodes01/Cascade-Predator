"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

interface OpenPosition {
  id: string;
  token: string;
  entryPrice: number;
  exitPrice: number | null;
  amount: string;
  status: string;
  openedAt: string;
  pnl: number | null;
}

interface SnapshotMetric {
  vaultBalance: string;
  dailyVolume: string;
  dailyCount: number;
  drawdownPct: number;
}

const TOKENS = ["WBNB", "CAKE", "FLOKI", "TWT", "PENDLE"];

function ScoreRing({ score, size = 160 }: { score: number; size?: number }) {
  const r = size / 2 - 12;
  const circ = 2 * Math.PI * r;
  const offset = circ - (circ * Math.min(100, score)) / 100;

  const color =
    score >= 70
      ? "#0052ff"
      : score >= 40
      ? "#b45309"
      : "#8a94a6";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#f1f3f7"
        strokeWidth={8}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={score >= 100 ? 28 : 32}
        fontWeight={700}
        fontFamily="Inter, sans-serif"
        fill={color}
      >
        {Math.round(score)}
      </text>
      <text
        x={size / 2}
        y={size / 2 + 22}
        textAnchor="middle"
        fontSize={10}
        fontFamily="Inter, sans-serif"
        fill="#8a94a6"
        fontWeight={500}
      >
        / 100
      </text>
    </svg>
  );
}

function FearGreedArc({ value }: { value: number }) {
  const label =
    value < 25 ? "Extreme Fear" : value < 45 ? "Fear" : value < 55 ? "Neutral" : value < 75 ? "Greed" : "Extreme Greed";
  const color =
    value < 25 ? "#d92d20" : value < 45 ? "#b45309" : value < 55 ? "#8a94a6" : value < 75 ? "#00875a" : "#7c3aed";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: "JetBrains Mono, monospace" }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color,
          background: `${color}18`,
          padding: "2px 8px",
          borderRadius: 20,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [snapshots, setSnapshots] = useState<RecentSnapshot[]>([]);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [metric, setMetric] = useState<SnapshotMetric | null>(null);
  const [selectedToken, setSelectedToken] = useState("WBNB");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.recentSnapshots || []);
        setPositions(data.openPositions || []);
        setMetric(data.metric);
        setAsOf(data.asOf);
        if (data.asOf) {
          setIsStale(Date.now() - new Date(data.asOf).getTime() > 30000);
        }
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

  // Group latest snapshot per token
  const byToken = snapshots.reduce((acc, s) => {
    if (!acc[s.token]) acc[s.token] = s;
    return acc;
  }, {} as Record<string, RecentSnapshot>);

  const snap = byToken[selectedToken];
  const score = snap?.cascadeScore ?? 0;
  const fearGreed = snap?.fearGreed ?? 50;
  const regime = snap?.regimeGateBlocked ? "BLOCKED" : "ACTIVE";
  const activePos = positions.find((p) => p.token === selectedToken) ?? null;

  const topTokens = TOKENS.map((t) => ({
    token: t,
    score: byToken[t]?.cascadeScore ?? 0,
    blocked: byToken[t]?.regimeGateBlocked ?? false,
  })).sort((a, b) => b.score - a.score);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
          <div style={{ fontSize: 14 }}>Loading live data…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }} className="animate-fade-up">
      {/* Page Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            Live Strategy Dashboard
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
            Real-time liquidation cascade signal monitoring across BSC tokens
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isStale && (
            <span className="badge badge-amber">⚠ Agent Quiet</span>
          )}
          {asOf && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Updated {new Date(asOf).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Summary Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
        {[
          {
            label: "Signals Today",
            value: metric?.dailyCount ?? "—",
            sub: "trade events",
            color: "var(--accent)",
          },
          {
            label: "Max Drawdown",
            value: metric?.drawdownPct != null ? `${metric.drawdownPct.toFixed(1)}%` : "—",
            sub: "vs peak equity",
            color: "var(--red)",
          },
          {
            label: "Open Positions",
            value: positions.length,
            sub: "active tokens",
            color: "var(--green)",
          },
          {
            label: "Daily Volume",
            value: metric?.dailyVolume ? `${(parseFloat(metric.dailyVolume) / 1e18).toFixed(4)}` : "—",
            sub: "BNB units",
            color: "var(--purple)",
          },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "20px 24px" }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color, marginTop: 6 }}>
              {s.value}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Main 2-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
        {/* Left: Signal Orb + Breakdown */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Token Selector */}
          <div className="card" style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginRight: 4 }}>
                MONITOR
              </span>
              {TOKENS.map((tok) => {
                const s = byToken[tok]?.cascadeScore ?? 0;
                return (
                  <button
                    key={tok}
                    onClick={() => setSelectedToken(tok)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: selectedToken === tok ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                      background: selectedToken === tok ? "var(--accent-light)" : "var(--bg-soft)",
                      color: selectedToken === tok ? "var(--accent)" : "var(--text-soft)",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "all 0.15s",
                    }}
                  >
                    {tok}
                    <span
                      style={{
                        fontSize: 11,
                        background: s >= 70 ? "var(--accent)" : s >= 40 ? "var(--amber)" : "var(--bg-muted)",
                        color: s >= 40 ? "white" : "var(--text-muted)",
                        borderRadius: 10,
                        padding: "1px 6px",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {s}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Score Orb Card */}
          <div className="card" style={{ padding: "36px 24px", textAlign: "center" }}>
            <div style={{ marginBottom: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}
              >
                Cascade Score — {selectedToken}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
              <ScoreRing score={score} size={200} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color:
                    score >= 70 ? "var(--accent)" : score >= 40 ? "var(--amber)" : "var(--text-muted)",
                  background:
                    score >= 70
                      ? "var(--accent-light)"
                      : score >= 40
                      ? "var(--amber-bg)"
                      : "var(--bg-muted)",
                  display: "inline-block",
                  padding: "4px 14px",
                  borderRadius: 20,
                }}
              >
                {score >= 70
                  ? "🔥 HIGH — Signal Threshold Reached"
                  : score >= 40
                  ? "⚡ BUILDING — Cascade Forming"
                  : "● QUIET — Watching Markets"}
              </div>
            </div>

            {/* Score Components */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left", marginTop: 20 }}>
              {[
                {
                  label: "Liquidation Intensity",
                  value: snap?.liquidationIntensity ?? 0,
                  max: 40,
                  color: "#0052ff",
                },
                {
                  label: "Price Deviation",
                  value: snap?.priceDeviation ?? 0,
                  max: 40,
                  color: "#7c3aed",
                },
                {
                  label: "Funding Stress",
                  value: snap?.fundingStress ?? 0,
                  max: 20,
                  color: "#b45309",
                },
              ].map((c) => (
                <div key={c.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ color: "var(--text-soft)", fontWeight: 500 }}>{c.label}</span>
                    <span
                      style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontWeight: 700,
                        color: "var(--text)",
                      }}
                    >
                      {c.value.toFixed(1)} / {c.max}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(c.value / c.max) * 100}%`,
                        background: c.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Regime & F&G */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginTop: 24,
                padding: "16px 0 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div className="stat-label">Market Regime</div>
                <div style={{ marginTop: 8 }}>
                  <span
                    className={`badge ${snap?.regimeGateBlocked ? "badge-amber" : "badge-green"}`}
                    style={{ fontSize: 12 }}
                  >
                    {snap?.regimeGateBlocked ? "⏸ BLOCKED" : "▶ ACTIVE"}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="stat-label">Fear & Greed</div>
                <div style={{ marginTop: 6 }}>
                  <FearGreedArc value={fearGreed} />
                </div>
              </div>
            </div>

            {/* Active Position Callout */}
            {activePos && (
              <div
                style={{
                  marginTop: 20,
                  padding: "14px 16px",
                  background: "var(--green-bg)",
                  border: "1px solid #bbf7d0",
                  borderRadius: 10,
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>
                    ● OPEN POSITION — {activePos.token}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: (activePos.pnl ?? 0) >= 0 ? "var(--green)" : "var(--red)",
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {(activePos.pnl ?? 0) >= 0 ? "+" : ""}
                    {((activePos.pnl ?? 0) * 100).toFixed(2)}% PnL
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                    fontSize: 12,
                    color: "var(--text-soft)",
                  }}
                >
                  <div>
                    Entry <strong style={{ color: "var(--text)" }}>${activePos.entryPrice.toFixed(4)}</strong>
                  </div>
                  <div>
                    TP <strong style={{ color: "var(--green)" }}>${(activePos.entryPrice * 1.03).toFixed(4)}</strong>
                  </div>
                  <div>
                    SL <strong style={{ color: "var(--red)" }}>${(activePos.entryPrice * 0.985).toFixed(4)}</strong>
                  </div>
                  <div>
                    Opened <strong style={{ color: "var(--text)" }}>{new Date(activePos.openedAt).toLocaleTimeString()}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Token Leaderboard + Quick Links */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Token Score Leaderboard */}
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Token Rankings
              </div>
            </div>
            <div>
              {topTokens.map((t, i) => (
                <div
                  key={t.token}
                  onClick={() => setSelectedToken(t.token)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 20px",
                    borderBottom: i < topTokens.length - 1 ? "1px solid var(--border)" : "none",
                    cursor: "pointer",
                    background: selectedToken === t.token ? "var(--accent-light)" : "transparent",
                    transition: "background 0.15s",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: i === 0 ? "linear-gradient(135deg, #0052ff, #7c3aed)" : "var(--bg-muted)",
                      color: i === 0 ? "white" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: selectedToken === t.token ? "var(--accent)" : "var(--text)",
                      }}
                    >
                      {t.token}
                    </div>
                    <div className="progress-track" style={{ marginTop: 5, height: 4 }}>
                      <div
                        className="progress-fill"
                        style={{
                          width: `${t.score}%`,
                          background:
                            t.score >= 70
                              ? "var(--accent)"
                              : t.score >= 40
                              ? "var(--amber)"
                              : "var(--bg-muted)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontFamily: "JetBrains Mono, monospace",
                        fontWeight: 700,
                        fontSize: 14,
                        color:
                          t.score >= 70
                            ? "var(--accent)"
                            : t.score >= 40
                            ? "var(--amber)"
                            : "var(--text-muted)",
                      }}
                    >
                      {t.score}
                    </div>
                    {t.blocked && (
                      <div style={{ fontSize: 10, color: "var(--amber)", fontWeight: 600 }}>BLOCKED</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Navigation */}
          <div className="card" style={{ padding: "20px" }}>
            <div className="section-title">Explore</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                {
                  href: "/scanner",
                  icon: "🔍",
                  label: "Token Scanner",
                  desc: "All tokens, live scores",
                },
                {
                  href: "/positions",
                  icon: "📊",
                  label: "Positions",
                  desc: `${positions.length} open positions`,
                },
                {
                  href: "/backtest",
                  icon: "📈",
                  label: "Backtest Results",
                  desc: "Historical performance",
                },
                {
                  href: "/ledger",
                  icon: "🔗",
                  label: "Proof Ledger",
                  desc: "Verifiable trade audit",
                },
                {
                  href: "/strategy",
                  icon: "⚡",
                  label: "Strategy Guide",
                  desc: "How the signal works",
                },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 8,
                    textDecoration: "none",
                    border: "1px solid var(--border)",
                    transition: "all 0.15s",
                    background: "var(--bg-soft)",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{item.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{item.desc}</div>
                  </div>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)", fontSize: 16 }}>→</span>
                </Link>
              ))}
            </div>
          </div>

          {/* System Info */}
          <div
            className="card-soft"
            style={{ padding: "14px 16px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.8 }}
          >
            <div style={{ fontWeight: 600, color: "var(--text-soft)", marginBottom: 6, fontSize: 12 }}>
              System Pipeline
            </div>
            {[
              ["Data", "CMC Agent Hub + Binance"],
              ["AI Gate", "Gemini 2.5 Flash"],
              ["Security", "Trust Wallet TWAK"],
              ["On-Chain", "ERC-8004 / ERC-8183"],
              ["Network", "BSC Testnet #97"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{k}</span>
                <span style={{ color: "var(--text)", fontWeight: 500, fontFamily: "JetBrains Mono, monospace", fontSize: 10 }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
