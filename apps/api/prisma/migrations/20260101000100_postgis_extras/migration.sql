-- Hand-written additions that Prisma's schema language cannot express.

-- Spatial (GIST) indexes
CREATE INDEX "sections_geom_gix"   ON "sections"   USING GIST ("geom");
CREATE INDEX "segments_geom_gix"   ON "segments"   USING GIST ("geom");
CREATE INDEX "crossings_geom_gix"  ON "crossings"  USING GIST ("geom");
CREATE INDEX "detections_geom_gix" ON "detections" USING GIST ("geom");

-- Data integrity
ALTER TABLE "segments"
  ADD CONSTRAINT "segments_exposure_range" CHECK (
    "heat_exposure" BETWEEN 0 AND 1 AND "flood_exposure" BETWEEN 0 AND 1
  ),
  ADD CONSTRAINT "segments_chainage_order" CHECK ("chainage_end_m" > "chainage_start_m");

ALTER TABLE "detections"
  ADD CONSTRAINT "detections_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "detections_has_source" CHECK (cardinality("sources") >= 1);

ALTER TABLE "crossing_events"
  ADD CONSTRAINT "crossing_events_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1);

ALTER TABLE "risk_scores"
  ADD CONSTRAINT "risk_scores_score_range" CHECK ("score" BETWEEN 1 AND 5);

ALTER TABLE "weather_inputs"
  ADD CONSTRAINT "weather_inputs_target" CHECK ("segment_id" IS NOT NULL OR "section_id" IS NOT NULL);

-- Partial indexes for the hottest dashboard queries
CREATE INDEX "detections_pending_idx" ON "detections" ("detected_at" DESC) WHERE "review_status" = 'PENDING';
CREATE INDEX "detections_severe_open_idx" ON "detections" ("segment_id") WHERE "severity" = 'SEVERE' AND "review_status" <> 'REJECTED';
CREATE INDEX "crossing_events_snapshot_idx" ON "crossing_events" ("occurred_at") WHERE "snapshot_key" IS NOT NULL AND "snapshot_purged_at" IS NULL;

-- Latest risk score per segment (history stays in risk_scores)
CREATE VIEW "segment_latest_risk" AS
SELECT DISTINCT ON ("segment_id")
  "segment_id", "computed_at", "score", "raw_value", "components", "model_version"
FROM "risk_scores"
ORDER BY "segment_id", "computed_at" DESC;
