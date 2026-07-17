-- Discord Server Backup Plugin — Migration 0001
-- {PREFIX} wird durch plugin_server_backup_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    id               INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    guild_id         VARCHAR(32)     NOT NULL,
    include_json     TEXT            NULL,
    schedule_enabled TINYINT(1)      NOT NULL DEFAULT 0,
    schedule_day     VARCHAR(8)      NOT NULL DEFAULT '1',
    schedule_time    VARCHAR(5)      NOT NULL DEFAULT '09:00',
    timezone         VARCHAR(64)     NOT NULL DEFAULT 'Europe/Berlin',
    last_run_key     VARCHAR(32)     NULL,
    updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ein Backup pro Guild — neues Backup überschreibt das alte (UNIQUE guild_id)
CREATE TABLE IF NOT EXISTS {PREFIX}backups (
    id           INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    guild_id     VARCHAR(32)     NOT NULL,
    guild_name   VARCHAR(120)    NULL,
    created_by   VARCHAR(32)     NULL,
    trigger_type VARCHAR(12)     NOT NULL DEFAULT 'manual',
    counts_json  TEXT            NULL,
    size_bytes   INT UNSIGNED    NOT NULL DEFAULT 0,
    data         LONGTEXT        NOT NULL,
    created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_guild (guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
