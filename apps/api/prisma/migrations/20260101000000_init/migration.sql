-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DIVISIONAL_ENGINEER', 'INSPECTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('TRACK', 'CROSSING');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'DEGRADED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "NetworkType" AS ENUM ('LTE_4G', 'LTE_3G', 'WIFI', 'SATELLITE', 'NONE');

-- CreateEnum
CREATE TYPE "CrossingStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "DefectClass" AS ENUM ('MISSING_FASTENER', 'BROKEN_FASTENER', 'DAMAGED_SLEEPER', 'RAIL_SURFACE_DEFECT', 'RAIL_JOINT_PROBLEM', 'BALLAST_DEFICIENCY', 'VEGETATION', 'GEOMETRY_IRREGULARITY');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('MINOR', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "DetectionSource" AS ENUM ('IMAGE', 'VIBRATION', 'ACOUSTIC');

-- CreateEnum
CREATE TYPE "FusionLevel" AS ENUM ('HIGH', 'REVIEW');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'NEEDS_INFO');

-- CreateEnum
CREATE TYPE "CrossingObjectClass" AS ENUM ('CAR', 'MOTORCYCLE', 'RICKSHAW', 'CART', 'TRACTOR', 'PERSON', 'LIVESTOCK', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ModelType" AS ENUM ('TRACK_DEFECT', 'CROSSING_VISION', 'RISK_ENGINE');

-- CreateTable
CREATE TABLE "divisions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "divisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sections" (
    "id" UUID NOT NULL,
    "division_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "from_station" TEXT NOT NULL,
    "to_station" TEXT NOT NULL,
    "length_km" DOUBLE PRECISION NOT NULL,
    "geom" geometry(LineString,4326) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "chainage_start_m" INTEGER NOT NULL,
    "chainage_end_m" INTEGER NOT NULL,
    "geom" geometry(LineString,4326) NOT NULL,
    "is_curve" BOOLEAN NOT NULL DEFAULT false,
    "has_bridge" BOOLEAN NOT NULL DEFAULT false,
    "near_crossing_id" UUID,
    "heat_exposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flood_exposure" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crossings" (
    "id" UUID NOT NULL,
    "division_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "geom" geometry(Point,4326) NOT NULL,
    "status" "CrossingStatus" NOT NULL DEFAULT 'ACTIVE',
    "danger_zone" JSONB,
    "unit_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crossings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "type" "DeviceType" NOT NULL,
    "serial" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "division_id" UUID NOT NULL,
    "firmware_version" TEXT,
    "model_version" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "battery_pct" DOUBLE PRECISION,
    "solar_w" DOUBLE PRECISION,
    "temperature_c" DOUBLE PRECISION,
    "storage_pct" DOUBLE PRECISION,
    "network" "NetworkType",
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "api_key_hash" TEXT,
    "api_key_prefix" TEXT,
    "revoked_at" TIMESTAMP(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "section_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "distance_km" DOUBLE PRECISION,
    "speed_avg_kmh" DOUBLE PRECISION,
    "samples_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detections" (
    "id" UUID NOT NULL,
    "run_id" UUID,
    "device_id" UUID NOT NULL,
    "segment_id" UUID,
    "geom" geometry(Point,4326) NOT NULL,
    "chainage_m" INTEGER,
    "detected_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "defect_class" "DefectClass" NOT NULL,
    "severity" "Severity" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sources" "DetectionSource"[],
    "fusion_level" "FusionLevel" NOT NULL,
    "image_key" TEXT,
    "audio_key" TEXT,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "detections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crossing_events" (
    "id" UUID NOT NULL,
    "crossing_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "object_class" "CrossingObjectClass" NOT NULL,
    "train_approaching" BOOLEAN NOT NULL,
    "dwell_seconds" DOUBLE PRECISION NOT NULL,
    "warning_triggered" BOOLEAN NOT NULL,
    "snapshot_key" TEXT,
    "snapshot_purged_at" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "crossing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_scores" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL,
    "raw_value" DOUBLE PRECISION NOT NULL,
    "components" JSONB NOT NULL,
    "model_version" TEXT NOT NULL,

    CONSTRAINT "risk_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "segment_id" UUID NOT NULL,
    "detection_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigned_to" UUID,
    "created_by" UUID,
    "due_date" DATE,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weather_inputs" (
    "id" UUID NOT NULL,
    "segment_id" UUID,
    "section_id" UUID,
    "date" DATE NOT NULL,
    "max_temp_c" DOUBLE PRECISION,
    "rainfall_mm" DOUBLE PRECISION,
    "flood_flag" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "weather_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" UUID NOT NULL,
    "type" "ModelType" NOT NULL,
    "version" TEXT NOT NULL,
    "metrics" JSONB,
    "released_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "r2_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "division_id" UUID,
    "password_hash" TEXT NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_logins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sections" (
    "user_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,

    CONSTRAINT "user_sections_pkey" PRIMARY KEY ("user_id","section_id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "device_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "division_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "divisions_code_key" ON "divisions"("code");

-- CreateIndex
CREATE INDEX "sections_division_id_idx" ON "sections"("division_id");

-- CreateIndex
CREATE INDEX "segments_near_crossing_id_idx" ON "segments"("near_crossing_id");

-- CreateIndex
CREATE UNIQUE INDEX "segments_section_id_chainage_start_m_key" ON "segments"("section_id", "chainage_start_m");

-- CreateIndex
CREATE UNIQUE INDEX "crossings_unit_id_key" ON "crossings"("unit_id");

-- CreateIndex
CREATE INDEX "crossings_division_id_idx" ON "crossings"("division_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_key" ON "devices"("serial");

-- CreateIndex
CREATE INDEX "devices_division_id_type_idx" ON "devices"("division_id", "type");

-- CreateIndex
CREATE INDEX "devices_last_seen_at_idx" ON "devices"("last_seen_at");

-- CreateIndex
CREATE INDEX "runs_device_id_started_at_idx" ON "runs"("device_id", "started_at");

-- CreateIndex
CREATE INDEX "runs_section_id_started_at_idx" ON "runs"("section_id", "started_at");

-- CreateIndex
CREATE INDEX "detections_segment_id_detected_at_idx" ON "detections"("segment_id", "detected_at");

-- CreateIndex
CREATE INDEX "detections_review_status_detected_at_idx" ON "detections"("review_status", "detected_at");

-- CreateIndex
CREATE INDEX "detections_severity_review_status_idx" ON "detections"("severity", "review_status");

-- CreateIndex
CREATE INDEX "detections_device_id_detected_at_idx" ON "detections"("device_id", "detected_at");

-- CreateIndex
CREATE INDEX "detections_defect_class_idx" ON "detections"("defect_class");

-- CreateIndex
CREATE INDEX "crossing_events_crossing_id_occurred_at_idx" ON "crossing_events"("crossing_id", "occurred_at");

-- CreateIndex
CREATE INDEX "crossing_events_warning_triggered_occurred_at_idx" ON "crossing_events"("warning_triggered", "occurred_at");

-- CreateIndex
CREATE INDEX "risk_scores_segment_id_computed_at_idx" ON "risk_scores"("segment_id", "computed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_scores_computed_at_idx" ON "risk_scores"("computed_at");

-- CreateIndex
CREATE INDEX "work_orders_status_due_date_idx" ON "work_orders"("status", "due_date");

-- CreateIndex
CREATE INDEX "work_orders_assigned_to_status_idx" ON "work_orders"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "work_orders_segment_id_idx" ON "work_orders"("segment_id");

-- CreateIndex
CREATE INDEX "weather_inputs_section_id_date_idx" ON "weather_inputs"("section_id", "date");

-- CreateIndex
CREATE INDEX "weather_inputs_segment_id_date_idx" ON "weather_inputs"("segment_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_type_version_key" ON "model_versions"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_division_id_role_idx" ON "users"("division_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_division_id_created_at_idx" ON "notifications"("division_id", "created_at");

-- AddForeignKey
ALTER TABLE "sections" ADD CONSTRAINT "sections_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_near_crossing_id_fkey" FOREIGN KEY ("near_crossing_id") REFERENCES "crossings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossings" ADD CONSTRAINT "crossings_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossings" ADD CONSTRAINT "crossings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossing_events" ADD CONSTRAINT "crossing_events_crossing_id_fkey" FOREIGN KEY ("crossing_id") REFERENCES "crossings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crossing_events" ADD CONSTRAINT "crossing_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_scores" ADD CONSTRAINT "risk_scores_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_inputs" ADD CONSTRAINT "weather_inputs_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weather_inputs" ADD CONSTRAINT "weather_inputs_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sections" ADD CONSTRAINT "user_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sections" ADD CONSTRAINT "user_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
