CREATE TABLE IF NOT EXISTS {PREFIX}channels (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id      BIGINT UNSIGNED NOT NULL,
    guild_id    VARCHAR(32)     NOT NULL,
    channel_id  VARCHAR(32)     NOT NULL,
    channel_name VARCHAR(100)   NULL DEFAULT NULL,
    mode        ENUM('media','gif','emoji','text') NOT NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_channel (bot_id, channel_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
