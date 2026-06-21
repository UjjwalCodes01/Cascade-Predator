import Link from "next/link";
import { PrismaClient } from "@prisma/client";
import CopyHelper from "./CopyHelper";

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
    console.warn("[ledger-page] Database connection failed, returning empty state:", dbError.message);
  }

  const totalPages = Math.ceil(total / pageSize);
  const bscScanBase = process.env.NEXT_PUBLIC_BSCSCAN_BASE || "https://bscscan.com";

  // Border helper every 5 rows
  const getRowBorderClass = (index: number, totalRows: number) => {
    if (index === totalRows - 1) return ""; // no border on last row
    return (index + 1) % 5 === 0 
      ? "border-b border-[rgba(255,255,255,0.06)]" 
      : "border-b border-transparent";
  };

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto px-4 md:px-0 font-data">
      
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100 tracking-wider">AUDIT PROOF LEDGER</h1>
        <p className="text-xs text-zinc-400 mt-1">Verifiable transaction logs and x402 micro-payment reports</p>
      </div>

      {/* Trades Table */}
      <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-6">
        <h2 className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-4">Trade Execution History</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-zinc-500">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.06)] text-zinc-400">
                <th className="py-3 px-2 font-semibold">Timestamp</th>
                <th className="py-3 px-2 font-semibold">Token Pair</th>
                <th className="py-3 px-2 font-semibold">Amount In</th>
                <th className="py-3 px-2 font-semibold">Amount Out</th>
                <th className="py-3 px-2 font-semibold">Cascade Score</th>
                <th className="py-3 px-2 font-semibold">Status</th>
                <th className="py-3 px-2 font-semibold">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-600">No trades recorded.</td>
                </tr>
              ) : (
                trades.map((t, idx) => (
                  <tr 
                    key={t.id} 
                    className={`hover:bg-zinc-900/10 transition-colors ${getRowBorderClass(idx, trades.length)}`}
                  >
                    <td className="py-3.5 px-2 text-zinc-500">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="py-3.5 px-2 text-zinc-300 font-semibold">{t.tokenIn} → {t.tokenOut}</td>
                    <td className="py-3.5 px-2">
                      <span className="font-display text-sm text-zinc-300 font-medium">
                        {parseFloat(t.amountIn).toFixed(4)}
                      </span>
                    </td>
                    <td className="py-3.5 px-2">
                      <span className="font-display text-sm text-zinc-300 font-medium">
                        {t.amountOut ? parseFloat(t.amountOut).toFixed(4) : "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-2">
                      <span className="font-display text-sm text-amber-500 font-bold">
                        {t.cascadeScore}%
                      </span>
                    </td>
                    <td className="py-3.5 px-2">
                      <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold ${
                        t.status === "success" ? "bg-emerald-950/40 border border-emerald-800/40 text-emerald-400" :
                        t.status === "failed" ? "bg-red-950/40 border border-red-800/40 text-red-400" :
                        "bg-zinc-800 text-zinc-400"
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-2">
                      {t.txHash ? (
                        <a
                          href={`${bscScanBase}/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 hover:text-zinc-300 hover:underline"
                        >
                          <CopyHelper text={t.txHash} startLen={8} endLen={6} />
                        </a>
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 border-t border-[rgba(255,255,255,0.06)] pt-4 text-xs">
            <span className="text-zinc-500">Showing page {page + 1} of {totalPages}</span>
            <div className="flex gap-2">
              <Link
                href={`/ledger?page=${Math.max(0, page - 1)}`}
                className={`px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 ${
                  page === 0 ? "pointer-events-none opacity-50" : ""
                }`}
              >
                Previous
              </Link>
              <Link
                href={`/ledger?page=${Math.min(totalPages - 1, page + 1)}`}
                className={`px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 ${
                  page >= totalPages - 1 ? "pointer-events-none opacity-50" : ""
                }`}
              >
                Next
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* X402 Micro-payments Table */}
      <div className="bg-zinc-950 border border-[rgba(255,255,255,0.06)] rounded-lg p-6">
        <h2 className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-4">X402 API Micro-payments Ledger</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs text-zinc-500">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.06)] text-zinc-400">
                <th className="py-3 px-2 font-semibold">Timestamp</th>
                <th className="py-3 px-2 font-semibold">Metered Resource</th>
                <th className="py-3 px-2 font-semibold">Amount Spent</th>
                <th className="py-3 px-2 font-semibold">Payment Proof Hash / Signature</th>
              </tr>
            </thead>
            <tbody>
              {x402.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-zinc-600">No micro-payments logged.</td>
                </tr>
              ) : (
                x402.map((x, idx) => (
                  <tr 
                    key={x.id} 
                    className={`hover:bg-zinc-900/10 transition-colors ${getRowBorderClass(idx, x402.length)}`}
                  >
                    <td className="py-3.5 px-2 text-zinc-500">{new Date(x.timestamp).toLocaleString()}</td>
                    <td className="py-3.5 px-2 text-zinc-300 font-semibold">{x.resource}</td>
                    <td className="py-3.5 px-2">
                      <span className="font-display text-sm text-zinc-300 font-medium">
                        {x.amountSpent} U
                      </span>
                    </td>
                    <td className="py-3.5 px-2">
                      {x.paymentProof ? (
                        <CopyHelper text={x.paymentProof} startLen={8} endLen={6} />
                      ) : (
                        <span className="text-zinc-700">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
