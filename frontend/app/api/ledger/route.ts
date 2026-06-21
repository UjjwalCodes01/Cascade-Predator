import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get("page") ?? "0"));
  const pageSize = 25;

  const [trades, x402, total] = await Promise.all([
    prisma.trade.findMany({
      orderBy: { timestamp: "desc" },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.x402Ledger.findMany({
      orderBy: { timestamp: "desc" },
      take: 50, // x402 is short, no need to paginate yet
    }),
    prisma.trade.count(),
  ]);

  return NextResponse.json({ trades, x402, page, pageSize, total });
}
