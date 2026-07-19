CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    bot_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    channel_id  VARCHAR(32)     NULL DEFAULT NULL,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}tracked (
    id                  INT UNSIGNED    AUTO_INCREMENT PRIMARY KEY,
    bot_id              BIGINT UNSIGNED NOT NULL,
    anilist_id          INT UNSIGNED    NOT NULL,
    title               VARCHAR(255)    NOT NULL,
    cover_url           VARCHAR(500)    NULL DEFAULT NULL,
    last_known_episode  INT UNSIGNED    NULL DEFAULT NULL,
    added_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bot_anime (bot_id, anilist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
