-- Global Chat Plugin Migration 0001
-- {PREFIX} wird durch plugin_globalchat_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}links (
    id          INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id      BIGINT UNSIGNED     NOT NULL,
    guild_id    VARCHAR(32)         NOT NULL,
    channel_id  VARCHAR(32)         NOT NULL,
    enabled     TINYINT(1)          NOT NULL DEFAULT 1,
    linked_at   TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_guild (bot_id, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
