ALTER TABLE {PREFIX}settings ADD COLUMN status_context_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER negative_prompt;
