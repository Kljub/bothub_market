CREATE TABLE IF NOT EXISTS {PREFIX}users (
    id         INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id     BIGINT UNSIGNED NOT NULL,
    user_id    VARCHAR(32)     NOT NULL,
    username   VARCHAR(64)     NOT NULL,
    updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_user (bot_id, user_id),
    KEY idx_bot_username (bot_id, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
