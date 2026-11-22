-- AlterTable
ALTER TABLE "detections" ADD COLUMN     "evidence_keys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "device_heartbeats" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "battery_pct" DOUBLE PRECISION,
    "solar_w" DOUBLE PRECISION,
    "temperature_c" DOUBLE PRECISION,
    "storage_pct" DOUBLE PRECISION,
    "network" "NetworkType",
    "queued_records" INTEGER,

    CONSTRAINT "device_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "division_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_heartbeats_device_id_received_at_idx" ON "device_heartbeats"("device_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "reports_division_id_month_idx" ON "reports"("division_id", "month");

-- AddForeignKey
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
