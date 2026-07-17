-- TempAttachments Plugin Migration 0001
-- {PREFIX} wird durch plugin_tempattachments_plugin_ ersetzt

CREATE TABLE IF NOT EXISTS {PREFIX}files (
    id                  INT UNSIGNED        AUTO_INCREMENT PRIMARY KEY,
    bot_id              BIGINT UNSIGNED     NOT NULL,
    guild_id            VARCHAR(32)         NOT NULL,
    name                VARCHAR(64)         NOT NULL,
    created_by          VARCHAR(32)         NOT NULL,
    text_content        TEXT                NULL,
    attachment_url      VARCHAR(1024)       NULL,
    attachment_filename VARCHAR(255)        NULL,
    password_hash       VARCHAR(255)        NULL,
    max_usages          INT UNSIGNED        NULL,
    used_count          INT UNSIGNED        NOT NULL DEFAULT 0,
    one_per_user        TINYINT(1)          NOT NULL DEFAULT 0,
    starting_date       DATETIME            NULL,
    expiring_date       DATETIME            NULL,
    message_id          VARCHAR(32)         NULL,
    channel_id          VARCHAR(32)         NULL,
    created_at          TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_guild_name (bot_id, guild_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}allowed_roles (
    id       INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    file_id  INT UNSIGNED   NOT NULL,
    role_id  VARCHAR(32)    NOT NULL,
    UNIQUE KEY uq_file_role (file_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}usage (
    id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    file_id  INT UNSIGNED    NOT NULL,
    user_id  VARCHAR(32)     NOT NULL,
    used_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_file_user (file_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
