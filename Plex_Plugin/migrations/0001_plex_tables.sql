CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    client_id               VARCHAR(20)   NOT NULL PRIMARY KEY,
    plex_server_url          VARCHAR(500) NULL DEFAULT NULL,
    plex_admin_token_enc     TEXT         NULL DEFAULT NULL,
    overseerr_url            VARCHAR(500) NULL DEFAULT NULL,
    overseerr_api_key_enc    TEXT         NULL DEFAULT NULL,
    webhook_secret           VARCHAR(64)  NOT NULL,
    updated_at                TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}guild_settings (
    client_id                 VARCHAR(20)  NOT NULL,
    guild_id                  VARCHAR(30)  NOT NULL,
    new_content_channel_id     VARCHAR(30) NULL DEFAULT NULL,
    live_status_channel_id     VARCHAR(30) NULL DEFAULT NULL,
    role_id                    VARCHAR(30) NULL DEFAULT NULL,
    allowed_library_ids        JSON        NULL DEFAULT NULL,
    created_at                 DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                 DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (client_id, guild_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}accounts (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    discord_user_id      VARCHAR(20)     NOT NULL,
    plex_uuid            VARCHAR(64)     NULL DEFAULT NULL,
    plex_username         VARCHAR(255)   NULL DEFAULT NULL,
    plex_email            VARCHAR(255)   NULL DEFAULT NULL,
    access_token_enc      TEXT           NULL DEFAULT NULL,
    nowplaying_optin       TINYINT(1)    NOT NULL DEFAULT 0,
    linked_at              DATETIME      NULL DEFAULT NULL,
    UNIQUE KEY uq_discord_user (discord_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}link_tokens (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    token                VARCHAR(64)     NOT NULL,
    discord_user_id       VARCHAR(20)    NOT NULL,
    guild_id              VARCHAR(30)    NOT NULL,
    plex_pin_id            BIGINT UNSIGNED NULL DEFAULT NULL,
    plex_pin_code          VARCHAR(64)   NULL DEFAULT NULL,
    client_identifier      VARCHAR(64)   NOT NULL,
    expires_at              DATETIME     NOT NULL,
    used                    TINYINT(1)   NOT NULL DEFAULT 0,
    created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_token (token),
    KEY idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}overseerr_requests (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    overseerr_request_id    INT UNSIGNED  NOT NULL,
    discord_user_id          VARCHAR(20)  NOT NULL,
    guild_id                 VARCHAR(30)  NOT NULL,
    created_at                DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_req (overseerr_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
