"use client";

import { useEffect, useState } from "react";

interface OpenPosition {
  id: string;
  token: string;
  entryPrice: number;
  exitPrice: number | null;
  amount: string;
  status: string;
  openedAt: string;
  closedAt?: string | null;
  pnl: number | null;
}

function PnLBadge({ pnl }: { pnl: number | null }) {
  if (pnl === null) return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>;
  const pct = (pnl * 100).toFixed(2);
  const isPos = pnl >= 0;
  return (
    <span
      className={`badge ${isPos ? "badge-green" : "badge-red"}`}
      style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
    >
      {isPos ? "+" : ""}{pct}%
    </span>
  );
}

function LadderBar({ entry, pnl }: { entry: number; pnl: number | null }) {
  const tp = entry * 1.03;
  const sl = entry * 0.985;
  const current = pnl !== null ? entry * (1 + pnl) : entry;
  const pct = Math.max(0, Math.min(100, ((current - sl) / (tp - sl)) * 100));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)" }}>
        <span style={{ color: "var(--red)" }}>SL ${sl.toFixed(4)}</span>
        <span style={{ color: "var(--text)" }}>Entry ${entry.toFixed(4)}</span>
        <span style={{ color: "var(--green)" }}>TP ${tp.toFixed(4)}</span>
      </div>
      <div
        style={{
          position: "relative",
          height: 8,
          background: "linear-gradient(90deg, #fef2f2 0%, #f1f3f7 50%, #f0fdf4 100%)",
          borderRadius: 10,
          border: "1px solid var(--border)",
        }}
      >
        {/* Entry marker */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "var(--border-strong)",
          }}
        />
        {/* Current price dot */}
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: pnl !== null && pnl >= 0 ? "var(--green)" : "var(--red)",
            border: "2px solid white",
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            transition: "left 0.5s ease",
          }}
        />
      </div>
    </div>
  );
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [allPositions, setAllPositions] = useState<OpenPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"open" | "closed">("open");

  const fetchData = async () => {
    try {
      const res = await fetch("/api/snapshot");
      if (res.ok) {
        const data = await res.json();
        const all = data.openPositions || [];
        setPositions(all.filter((p: OpenPosition) => p.status === "open"));
        setAllPositions(all);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Also fetch from ledger for closed
  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, []);

  const openPositions = allPositions.filter((p) => p.status === "open");
  const closedPositions = allPositions.filter((p) => p.status === "closed");
  const displayList = tab === "open" ? openPositions : closedPositions;

  const totalPnl = closedPositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  const winCount = closedPositions.filter((p) => (p.pnl ?? 0) > 0).length;
  const winRate = closedPositions.length > 0 ? (winCount / closedPositions.length) * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }} className="animate-fade-up">
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Positions
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
          Open and closed strategy positions with P&L tracking
        </p>
      </div>

      {/* Stats Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        {[
          {
            label: "Open Positions",
            value: openPositions.length,
            color: "var(--accent)",
          },
          {
            label: "Closed Trades",
            value: closedPositions.length,
            color: "var(--text)",
          },
          {
            label: "Win Rate",
            value: `${winRate.toFixed(0)}%`,
            color: winRate >= 50 ? "var(--green)" : "var(--red)",
          },
          {
            label: "Total PnL",
            value: `${totalPnl >= 0 ? "+" : ""}${(totalPnl * 100).toFixed(2)}%`,
            color: totalPnl >= 0 ? "var(--green)" : "var(--red)",
          },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "18px 20px" }}>
            <div className="stat-label">{s.label}</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
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

      {/* Tab Switcher */}
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
        {[
          { key: "open", label: `Open (${openPositions.length})` },
          { key: "closed", label: `Closed (${closedPositions.length})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "open" | "closed")}
            style={{
              padding: "6px 18px",
              borderRadius: 8,
              border: "none",
              background: tab === t.key ? "var(--bg)" : "transparent",
              color: tab === t.key ? "var(--text)" : "var(--text-muted)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              boxShadow: tab === t.key ? "var(--shadow-sm)" : "none",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Positions List */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-shimmer" style={{ height: 140, borderRadius: 10 }} />
          ))}
        </div>
      ) : displayList.length === 0 ? (
        <div className="card" style={{ padding: "60px 24px", textAlign: "center", color: "var(--text-muted)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>
            {tab === "open" ? "📭" : "📋"}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
            {tab === "open" ? "No open positions" : "No closed positions yet"}
          </div>
          <div style={{ fontSize: 13 }}>
            {tab === "open"
              ? "The agent is scanning markets. A position will appear when a cascade signal is confirmed."
              : "Closed positions will appear here after the agent exits trades."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {displayList.map((pos) => {
            const isOpen = pos.status === "open";
            const pnlVal = pos.pnl ?? 0;

            return (
              <div
                key={pos.id}
                className="card"
                style={{
                  padding: "20px 24px",
                  borderColor: isOpen
                    ? "#bfdbfe"
                    : pnlVal >= 0
                    ? "#bbf7d0"
                    : "#fecaca",
                  borderWidth: 1,
                }}
              >
                {/* Row header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                    flexWrap: "wrap",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: isOpen
                          ? "var(--accent-light)"
                          : pnlVal >= 0
                          ? "var(--green-bg)"
                          : "var(--red-bg)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        fontWeight: 800,
                        color: isOpen
                          ? "var(--accent)"
                          : pnlVal >= 0
                          ? "var(--green)"
                          : "var(--red)",
                        fontFamily: "JetBrains Mono, monospace",
                        flexShrink: 0,
                      }}
                    >
                      {pos.token.slice(0, 2)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{pos.token}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {isOpen ? "●" : "○"} {isOpen ? "Open" : "Closed"} ·{" "}
                        {new Date(pos.openedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className={`badge ${isOpen ? "badge-blue" : pnlVal >= 0 ? "badge-green" : "badge-red"}`}>
                      {isOpen ? "ACTIVE" : pnlVal >= 0 ? "WIN" : "LOSS"}
                    </span>
                    <PnLBadge pnl={pos.pnl} />
                  </div>
                </div>

                {/* Price Ladder */}
                {isOpen && (
                  <div style={{ marginBottom: 16 }}>
                    <LadderBar entry={pos.entryPrice} pnl={pos.pnl} />
                  </div>
                )}

                {/* Details grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 10,
                    fontSize: 12,
                  }}
                >
                  {[
                    { label: "Entry Price", value: `$${pos.entryPrice.toFixed(4)}` },
                    { label: "Take Profit", value: `$${(pos.entryPrice * 1.03).toFixed(4)}`, color: "var(--green)" },
                    { label: "Stop Loss", value: `$${(pos.entryPrice * 0.985).toFixed(4)}`, color: "var(--red)" },
                    { label: "Amount", value: pos.amount },
                    {
                      label: "Opened",
                      value: new Date(pos.openedAt).toLocaleTimeString(),
                    },
                    pos.closedAt
                      ? { label: "Closed", value: new Date(pos.closedAt).toLocaleTimeString() }
                      : { label: "Exit Price", value: pos.exitPrice ? `$${pos.exitPrice.toFixed(4)}` : "—" },
                  ].map((field) => (
                    <div
                      key={field.label}
                      style={{
                        padding: "8px 12px",
                        background: "var(--bg-soft)",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 500, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {field.label}
                      </div>
                      <div
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontWeight: 600,
                          color: "color" in field ? field.color : "var(--text)",
                        }}
                      >
                        {field.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
