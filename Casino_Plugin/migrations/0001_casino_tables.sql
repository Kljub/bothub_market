-- Casino Plugin Migration 0001
-- {PREFIX} wird durch plugin_casino_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}game_settings (
    id                  INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id              BIGINT UNSIGNED     NOT NULL,
    game_key            VARCHAR(32)         NOT NULL,
    enabled             TINYINT(1)          NOT NULL DEFAULT 1,
    rtp                 DECIMAL(5,2)        NOT NULL DEFAULT 95.00,
    min_bet             INT                 NOT NULL DEFAULT 10,
    max_bet             INT                 NOT NULL DEFAULT 1000,
    allowed_currencies  JSON                NULL,
    updated_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_game (bot_id, game_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
