import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0"));
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
    console.warn("[ledger-api] Database connection failed, returning empty state:", dbError.message);
  }

  return NextResponse.json({ trades, x402, page, pageSize, total });
}
