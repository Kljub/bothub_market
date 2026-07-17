-- Criminal Plugin Migration 0001
-- {PREFIX} wird durch plugin_criminal_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    id                    INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id                BIGINT UNSIGNED     NOT NULL,
    success_chance        DECIMAL(5,2)        NOT NULL DEFAULT 50.00,
    steal_percent         DECIMAL(5,2)        NOT NULL DEFAULT 20.00,
    fail_penalty_percent  DECIMAL(5,2)        NOT NULL DEFAULT 15.00,
    allowed_currencies    JSON                NULL,
    updated_at            TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
