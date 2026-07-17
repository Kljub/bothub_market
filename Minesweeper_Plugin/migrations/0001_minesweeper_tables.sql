-- Minesweeper Plugin Migration 0001
-- {PREFIX} wird durch plugin_minesweeper_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    id                  INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id              BIGINT UNSIGNED     NOT NULL,
    enabled             TINYINT(1)          NOT NULL DEFAULT 1,
    rtp                 DECIMAL(5,2)        NOT NULL DEFAULT 97.00,
    min_bet             INT                 NOT NULL DEFAULT 10,
    max_bet             INT                 NOT NULL DEFAULT 1000,
    allowed_currencies  JSON                NULL,
    updated_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
