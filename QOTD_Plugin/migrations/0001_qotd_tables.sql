-- QOTD Plugin Migration 0001
-- {PREFIX} wird durch plugin_qotd_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}facts (
    id          INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id      BIGINT UNSIGNED     NOT NULL,
    text        TEXT                NOT NULL,
    enabled     TINYINT(1)          NOT NULL DEFAULT 1,
    created_at  TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}usage (
    id              BIGINT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    bot_id          BIGINT UNSIGNED     NOT NULL,
    guild_id        VARCHAR(32)         NOT NULL,
    user_id         VARCHAR(32)         NOT NULL,
    last_used_date  DATE                NOT NULL,
    UNIQUE KEY uq_usage (bot_id, guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
