CREATE TABLE IF NOT EXISTS {PREFIX}settings (
    client_id                  VARCHAR(20)         NOT NULL PRIMARY KEY,
    active_provider             VARCHAR(20)        NOT NULL DEFAULT 'openai',
    system_prompt               TEXT               NULL DEFAULT NULL,
    max_tokens                  INT UNSIGNED       NOT NULL DEFAULT 1000,
    temperature                 DECIMAL(3,2)       NOT NULL DEFAULT 0.70,
    history_length              TINYINT UNSIGNED   NOT NULL DEFAULT 10,
    session_timeout_min         SMALLINT UNSIGNED  NOT NULL DEFAULT 30,
    web_search_enabled          TINYINT(1)         NOT NULL DEFAULT 0,
    web_search_always           TINYINT(1)         NOT NULL DEFAULT 0,
    brave_api_key                TEXT              NULL DEFAULT NULL,
    searxng_url                  VARCHAR(500)      NULL DEFAULT NULL,
    mention_enabled              TINYINT(1)        NOT NULL DEFAULT 0,
    mention_allowed_channels     TEXT              NULL DEFAULT NULL,
    updated_at                   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}providers (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id       VARCHAR(20)     NOT NULL,
    provider        VARCHAR(20)     NOT NULL,
    api_key         TEXT            NULL DEFAULT NULL,
    base_url        VARCHAR(500)    NULL DEFAULT NULL,
    selected_model  VARCHAR(255)    NULL DEFAULT NULL,
    UNIQUE KEY uq_client_provider (client_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS {PREFIX}history (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    client_id   VARCHAR(20)     NOT NULL,
    user_id     VARCHAR(20)     NOT NULL,
    role        ENUM('user','assistant') NOT NULL,
    content     MEDIUMTEXT      NOT NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_client_user_time (client_id, user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
