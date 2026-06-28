-- Store the linked plan's display name on the session, so a continued or listed
-- session can show its route name (the plan id isn't kept — only a KV copy).
ALTER TABLE tracking_sessions ADD COLUMN plan_name TEXT;
