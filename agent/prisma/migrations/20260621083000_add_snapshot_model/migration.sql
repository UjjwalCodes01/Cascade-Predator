-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cascadeScore" DOUBLE PRECISION NOT NULL,
    "liquidationIntensity" DOUBLE PRECISION NOT NULL,
    "priceDeviation" DOUBLE PRECISION NOT NULL,
    "fundingStress" DOUBLE PRECISION NOT NULL,
    "fearGreed" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);
