CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    bot_id           BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    channel_id       VARCHAR(32)     NULL DEFAULT NULL,
    mode             ENUM('single','multi') NOT NULL DEFAULT 'multi',
    interval_minutes INT UNSIGNED    NOT NULL DEFAULT 5,
    message_id       VARCHAR(32)     NULL DEFAULT NULL,
    last_run_at      DATETIME        NULL DEFAULT NULL,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}sites (
    id             INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id         BIGINT UNSIGNED NOT NULL,
    name           VARCHAR(64)     NOT NULL,
    url            VARCHAR(500)    NOT NULL,
    message_id     VARCHAR(32)     NULL DEFAULT NULL,
    last_status    ENUM('green','yellow','red') NULL DEFAULT NULL,
    last_latency_ms INT UNSIGNED   NULL DEFAULT NULL,
    last_checked_at DATETIME       NULL DEFAULT NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
