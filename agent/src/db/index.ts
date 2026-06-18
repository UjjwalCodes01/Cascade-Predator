import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export class DbService {
  static async getOpenPositions() {
    return prisma.position.findMany({
      where: { status: "open" },
    });
  }

  static async closePosition(id: string, exitPrice: number, pnl: number) {
    return prisma.position.update({
      where: { id },
      data: {
        status: "closed",
        exitPrice,
        closedAt: new Date(),
        pnl,
      },
    });
  }

  static async recordMetric(
    vaultBalance: string,
    dailyVolume: string,
    dailyCount: number,
    drawdownPct: number
  ) {
    return prisma.metric.create({
      data: {
        vaultBalance,
        dailyVolume,
        dailyCount,
        drawdownPct,
      },
    });
  }
}
