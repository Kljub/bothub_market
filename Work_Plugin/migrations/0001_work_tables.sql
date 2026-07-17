-- Work Plugin Migration 0001
-- {PREFIX} wird durch plugin_work_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}jobs (
    id                  INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id              BIGINT UNSIGNED     NOT NULL,
    job_key             VARCHAR(32)         NOT NULL,
    name                VARCHAR(64)         NOT NULL,
    description         VARCHAR(255)        NOT NULL DEFAULT '',
    emoji               VARCHAR(16)         NOT NULL DEFAULT '💼',
    pay_min             INT                 NOT NULL DEFAULT 10,
    pay_max             INT                 NOT NULL DEFAULT 50,
    cooldown_seconds    INT                 NOT NULL DEFAULT 3600,
    currency_key        VARCHAR(32)         NULL,
    enabled             TINYINT(1)          NOT NULL DEFAULT 1,
    sort_order          INT                 NOT NULL DEFAULT 0,
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_job (bot_id, job_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}employment (
    id              BIGINT UNSIGNED     AUTO_INCREMENT PRIMARY KEY,
    bot_id          BIGINT UNSIGNED     NOT NULL,
    guild_id        VARCHAR(32)         NOT NULL,
    user_id         VARCHAR(32)         NOT NULL,
    job_key         VARCHAR(32)         NOT NULL,
    last_worked_at  DATETIME            NULL DEFAULT NULL,
    hired_at        TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_employment (bot_id, guild_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
