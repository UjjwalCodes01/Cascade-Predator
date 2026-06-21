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

  const [trades, x402, total] = await Promise.all([
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

  const totalPages = Math.ceil(total / pageSize);
  const bscScanBase = process.env.NEXT_PUBLIC_BSCSCAN_BASE || "https://bscscan.com";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold font-mono text-zinc-100">Audit Proof Ledger</h1>
        <p className="text-sm text-zinc-400">Verifiable transaction logs and x402 micro-payment reports</p>
      </div>

      {/* Trades Table */}
      <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6">
        <h2 className="text-lg font-bold font-mono text-zinc-200 mb-4">Trade Execution History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono text-zinc-400">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-300">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Token Pair</th>
                <th className="py-3 px-4">Amount In</th>
                <th className="py-3 px-4">Amount Out</th>
                <th className="py-3 px-4">Cascade Score</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-zinc-500">No trades recorded.</td>
                </tr>
              ) : (
                trades.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                    <td className="py-3 px-4">{new Date(t.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-4 text-zinc-200 font-semibold">{t.tokenIn} → {t.tokenOut}</td>
                    <td className="py-3 px-4">{parseFloat(t.amountIn).toFixed(4)}</td>
                    <td className="py-3 px-4">{t.amountOut ? parseFloat(t.amountOut).toFixed(4) : "N/A"}</td>
                    <td className="py-3 px-4 text-amber-500 font-bold">{t.cascadeScore}%</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                        t.status === "success" ? "bg-emerald-950 text-emerald-400 border border-emerald-500/35" :
                        t.status === "failed" ? "bg-red-950 text-red-400 border border-red-500/35" :
                        "bg-zinc-800 text-zinc-300"
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {t.txHash ? (
                        <a
                          href={`${bscScanBase}/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-500 hover:underline"
                        >
                          {t.txHash.slice(0, 10)}...
                        </a>
                      ) : (
                        <span className="text-zinc-600">—</span>
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
          <div className="flex items-center justify-between mt-4 border-t border-zinc-800 pt-4 text-xs font-mono">
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
      <div className="bg-[#0f1115] border border-zinc-800 rounded-lg p-6">
        <h2 className="text-lg font-bold font-mono text-zinc-200 mb-4">X402 API Ledger</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono text-zinc-400">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-300">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Metered Resource</th>
                <th className="py-3 px-4">Amount Spent</th>
                <th className="py-3 px-4">Payment Proof</th>
              </tr>
            </thead>
            <tbody>
              {x402.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-zinc-500">No micro-payments logged.</td>
                </tr>
              ) : (
                x402.map((x) => (
                  <tr key={x.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                    <td className="py-3 px-4">{new Date(x.timestamp).toLocaleString()}</td>
                    <td className="py-3 px-4 text-zinc-300 font-semibold">{x.resource}</td>
                    <td className="py-3 px-4 text-amber-500">{x.amountSpent} U</td>
                    <td className="py-3 px-4">
                      {x.paymentProof ? (
                        x.paymentProof.startsWith("0x") ? (
                          <a
                            href={`https://basescan.org/tx/${x.paymentProof}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-500 hover:underline"
                          >
                            {x.paymentProof.slice(0, 15)}...
                          </a>
                        ) : (
                          <span className="text-zinc-300 break-all select-all bg-zinc-900 border border-zinc-850 px-2 py-1 rounded">
                            {x.paymentProof}
                          </span>
                        )
                      ) : (
                        <span className="text-zinc-600">—</span>
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
