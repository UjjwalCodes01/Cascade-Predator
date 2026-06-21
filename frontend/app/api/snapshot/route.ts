import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic"; // never cache; this is live data

export async function GET() {
  try {
    // Latest metric row gives vault balance, daily volume/count, drawdown
    const latestMetric = await prisma.metric.findFirst({
      orderBy: { timestamp: "desc" },
    });

    // Open position(s), if any
    const openPositions = await prisma.position.findMany({
      where: { status: "open" },
      orderBy: { openedAt: "desc" },
    });

    // Most recent trades
    const recentTrades = await prisma.trade.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    // Most recent snapshots (written per-tick by agent)
    const recentSnapshots = await prisma.snapshot.findMany({
      orderBy: { timestamp: "desc" },
      take: 50,
    });

    return NextResponse.json({
      metric: latestMetric,
      openPositions,
      recentTrades,
      recentSnapshots,
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Snapshot query failed", detail: String(e) },
      { status: 500 }
    );
  }
}
