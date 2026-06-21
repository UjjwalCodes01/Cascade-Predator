import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic"; // never cache; this is live data

export async function GET() {
  try {
    let latestMetric = null;
    let openPositions: any[] = [];
    let recentTrades: any[] = [];
    let recentSnapshots: any[] = [];

    try {
      const [metric, positions, trades, snapshots] = await Promise.all([
        prisma.metric.findFirst({
          orderBy: { timestamp: "desc" },
        }),
        prisma.position.findMany({
          where: { status: "open" },
          orderBy: { openedAt: "desc" },
        }),
        prisma.trade.findMany({
          orderBy: { timestamp: "desc" },
          take: 50,
        }),
        prisma.snapshot.findMany({
          orderBy: { timestamp: "desc" },
          take: 50,
        }),
      ]);
      latestMetric = metric;
      openPositions = positions;
      recentTrades = trades;
      recentSnapshots = snapshots;
    } catch (dbError: any) {
      console.warn("[snapshot-api] Database query failed, returning empty state:", dbError.message);
    }

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
