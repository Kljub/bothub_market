CREATE TABLE IF NOT EXISTS {PREFIX}sounds (
    id          INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id      BIGINT UNSIGNED NOT NULL,
    name        VARCHAR(32)     NOT NULL,
    filename    VARCHAR(255)    NOT NULL,
    uploaded_by VARCHAR(64)     NULL DEFAULT NULL,
    play_count  INT UNSIGNED    NOT NULL DEFAULT 0,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_name (bot_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
