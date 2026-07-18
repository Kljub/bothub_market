CREATE TABLE IF NOT EXISTS {PREFIX}relay_map (
    id         INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id     BIGINT UNSIGNED NOT NULL,
    group_key  VARCHAR(80)     NOT NULL,
    channel_id VARCHAR(32)     NOT NULL,
    message_id VARCHAR(32)     NOT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_channel_message (bot_id, channel_id, message_id),
    KEY idx_group (bot_id, group_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
