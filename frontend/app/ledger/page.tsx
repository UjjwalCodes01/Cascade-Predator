import Link from "next/link";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function LedgerPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const page = Math.max(0, parseInt(resolvedSearchParams.page ?? "0", 10));
  const pageSize = 25;

  let trades: any[] = [];
  let x402: any[] = [];
  let total = 0;

  try {
    const [tList, xList, count] = await Promise.all([
      prisma.trade.findMany({
        orderBy: { timestamp: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.x402Ledger.findMany({
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
      prisma.trade.count(),
    ]);
    trades = tList;
    x402 = xList;
    total = count;
  } catch (dbError: any) {
    console.warn("[ledger-page] Database connection failed:", dbError.message);
  }

  const totalPages = Math.ceil(total / pageSize);
  const bscScanBase = process.env.NEXT_PUBLIC_BSCSCAN_BASE || "https://bscscan.com";

  const successCount = trades.filter((t) => t.status === "success").length;
  const totalVolume = trades.reduce((sum, t) => sum + parseFloat(t.amountIn || "0"), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Proof Ledger
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" }}>
          Verifiable on-chain trade history and x402 API micro-payment audit trail
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
        {[
          { label: "Total Trades", value: total, color: "var(--text)" },
          {
            label: "Success Rate",
            value: total > 0 ? `${((successCount / trades.length) * 100).toFixed(0)}%` : "—",
            color: "var(--green)",
          },
          {
            label: "x402 Payments",
            value: x402.length,
            color: "var(--accent)",
          },
          {
            label: "Volume (BNB)",
            value: totalVolume.toFixed(4),
            color: "var(--purple)",
          },
        ].map((s) => (
          <div key={s.label} className="card" style={{ padding: "16px 20px" }}>
            <div className="stat-label">{s.label}</div>
            <div
              style={{
                fontSize: 22,
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

      {/* Trades Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Trade Execution History</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {total} records · Page {page + 1} of {Math.max(1, totalPages)}
            </div>
          </div>
          <span className="badge badge-blue">On-Chain Verifiable</span>
        </div>

        <div style={{ overflowX: "auto" }}>
          {trades.length === 0 ? (
            <div
              style={{
                padding: "60px 24px",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>No trades recorded yet</div>
              <div style={{ fontSize: 13 }}>
                Trades will appear here once the agent executes its first strategy signal.
              </div>
            </div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Token Pair</th>
                  <th style={{ textAlign: "right" }}>Amount In</th>
                  <th style={{ textAlign: "right" }}>Amount Out</th>
                  <th style={{ textAlign: "right" }}>Cascade Score</th>
                  <th>Status</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                      {new Date(t.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: "var(--text)", fontSize: 13 }}>
                        {t.tokenIn}
                      </span>
                      <span style={{ color: "var(--text-muted)", margin: "0 4px" }}>→</span>
                      <span style={{ fontWeight: 600, color: "var(--text-soft)" }}>{t.tokenOut}</span>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontWeight: 600, color: "var(--text)" }}>
                      {parseFloat(t.amountIn).toFixed(4)}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", color: "var(--text-soft)" }}>
                      {t.amountOut ? parseFloat(t.amountOut).toFixed(4) : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontFamily: "JetBrains Mono, monospace",
                          fontWeight: 700,
                          color: t.cascadeScore >= 70 ? "var(--accent)" : "var(--amber)",
                          fontSize: 13,
                        }}
                      >
                        {t.cascadeScore}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          t.status === "success"
                            ? "badge-green"
                            : t.status === "failed"
                            ? "badge-red"
                            : "badge-gray"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td>
                      {t.txHash ? (
                        <a
                          href={`${bscScanBase}/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: 12,
                            color: "var(--accent)",
                            textDecoration: "none",
                          }}
                        >
                          {t.txHash.slice(0, 8)}…{t.txHash.slice(-6)} ↗
                        </a>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--text-muted)" }}>
              Page {page + 1} of {totalPages}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Link
                href={`/ledger?page=${Math.max(0, page - 1)}`}
                className="btn btn-ghost"
                style={{ opacity: page === 0 ? 0.4 : 1, pointerEvents: page === 0 ? "none" : "auto" }}
              >
                ← Prev
              </Link>
              <Link
                href={`/ledger?page=${Math.min(totalPages - 1, page + 1)}`}
                className="btn btn-ghost"
                style={{
                  opacity: page >= totalPages - 1 ? 0.4 : 1,
                  pointerEvents: page >= totalPages - 1 ? "none" : "auto",
                }}
              >
                Next →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* x402 Micro-payments */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>x402 API Micro-payment Ledger</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            CMC API metered payments via the HTTP 402 protocol
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          {x402.length === 0 ? (
            <div
              style={{
                padding: "40px 24px",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: 13 }}>No x402 micro-payments logged yet.</div>
            </div>
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Metered Resource</th>
                  <th style={{ textAlign: "right" }}>Amount Spent</th>
                  <th>Payment Proof</th>
                </tr>
              </thead>
              <tbody>
                {x402.map((x) => (
                  <tr key={x.id}>
                    <td style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                      {new Date(x.timestamp).toLocaleString()}
                    </td>
                    <td style={{ fontWeight: 600, color: "var(--text)" }}>{x.resource}</td>
                    <td style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontWeight: 700 }}>
                      {x.amountSpent} U
                    </td>
                    <td>
                      {x.paymentProof ? (
                        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--text-muted)" }}>
                          {x.paymentProof.slice(0, 10)}…{x.paymentProof.slice(-6)}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
