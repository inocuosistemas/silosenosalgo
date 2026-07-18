-- Beacon activity type: the movement the broadcaster reports (walk / run / bike /
-- transport), so the viewer shows the right speed unit (min/km pace vs km/h), the
-- activity icon, and a realistic max-speed to hide "impossible" GPS jumps. NULL =
-- auto (the viewer infers it from the observed speed). Nullable + no default so
-- existing sessions read as auto. Values validated in the API (isBeaconActivity).
ALTER TABLE tracking_sessions ADD COLUMN activity TEXT;
