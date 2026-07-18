ALTER TABLE {PREFIX}settings ADD COLUMN positive_prompt TEXT NULL DEFAULT NULL AFTER system_prompt;
ALTER TABLE {PREFIX}settings ADD COLUMN negative_prompt TEXT NULL DEFAULT NULL AFTER positive_prompt;
