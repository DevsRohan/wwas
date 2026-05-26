-- ============================================================
-- WWAS WhatsApp CRM - Complete Database Schema
-- Production-Grade MySQL Schema with Indexes & Foreign Keys
-- ============================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+05:30";

-- Drop existing tables in reverse dependency order
DROP TABLE IF EXISTS `logs`;
DROP TABLE IF EXISTS `messages`;
DROP TABLE IF EXISTS `campaigns`;
DROP TABLE IF EXISTS `leads`;
DROP TABLE IF EXISTS `settings`;
DROP TABLE IF EXISTS `admin_users`;

-- ============================================================
-- TABLE: admin_users
-- ============================================================
CREATE TABLE `admin_users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(100) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `email`         VARCHAR(255) DEFAULT NULL,
  `last_login`    DATETIME DEFAULT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: settings
-- ============================================================
CREATE TABLE `settings` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `key_name`    VARCHAR(100) NOT NULL,
  `key_value`   TEXT DEFAULT NULL,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_key_name` (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: campaigns
-- ============================================================
CREATE TABLE `campaigns` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(255) NOT NULL,
  `status`         ENUM('idle','running','paused','completed','failed') NOT NULL DEFAULT 'idle',
  `total_leads`    INT UNSIGNED NOT NULL DEFAULT 0,
  `sent_count`     INT UNSIGNED NOT NULL DEFAULT 0,
  `replied_count`  INT UNSIGNED NOT NULL DEFAULT 0,
  `failed_count`   INT UNSIGNED NOT NULL DEFAULT 0,
  `skipped_count`  INT UNSIGNED NOT NULL DEFAULT 0,
  `started_at`     DATETIME DEFAULT NULL,
  `completed_at`   DATETIME DEFAULT NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: leads
-- ============================================================
CREATE TABLE `leads` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `business_name`     VARCHAR(255) NOT NULL,
  `address`           TEXT DEFAULT NULL,
  `locality`          VARCHAR(150) DEFAULT NULL,
  `city`              VARCHAR(100) DEFAULT NULL,
  `state`             VARCHAR(100) DEFAULT NULL,
  `phone_number`      VARCHAR(25) NOT NULL,
  `website_url`       VARCHAR(500) DEFAULT NULL,
  `website_status`    ENUM('yes','no') NOT NULL DEFAULT 'no',
  `rating`            DECIMAL(3,1) DEFAULT NULL,
  `review_count`      INT UNSIGNED NOT NULL DEFAULT 0,
  `whatsapp_status`   ENUM('pending','valid','invalid','not_on_whatsapp','failed') NOT NULL DEFAULT 'pending',
  `outreach_status`   ENUM('pending','queued','sent','replied','failed','skipped') NOT NULL DEFAULT 'pending',
  `pitch_type`        ENUM('A','B') NOT NULL DEFAULT 'B',
  `language_pref`     VARCHAR(50) NOT NULL DEFAULT 'english',
  `generated_message` TEXT DEFAULT NULL,
  `tags`              JSON DEFAULT NULL,
  `notes`             TEXT DEFAULT NULL,
  `campaign_id`       INT UNSIGNED DEFAULT NULL,
  `last_contacted_at` DATETIME DEFAULT NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_phone_number` (`phone_number`),
  KEY `idx_whatsapp_status` (`whatsapp_status`),
  KEY `idx_outreach_status` (`outreach_status`),
  KEY `idx_city_state` (`city`, `state`),
  KEY `idx_pitch_type` (`pitch_type`),
  KEY `idx_campaign_id` (`campaign_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_leads_campaign` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: messages
-- ============================================================
CREATE TABLE `messages` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `lead_id`       INT UNSIGNED NOT NULL,
  `sender`        ENUM('user','lead') NOT NULL,
  `message_text`  TEXT NOT NULL,
  `wa_message_id` VARCHAR(150) DEFAULT NULL,
  `direction`     ENUM('inbound','outbound') NOT NULL,
  `is_read`       TINYINT(1) NOT NULL DEFAULT 0,
  `status`        ENUM('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'pending',
  `timestamp`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wa_message_id` (`wa_message_id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_direction` (`direction`),
  KEY `idx_timestamp` (`timestamp`),
  KEY `idx_is_read` (`is_read`),
  CONSTRAINT `fk_messages_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: logs
-- ============================================================
CREATE TABLE `logs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `level`      ENUM('info','warning','error','debug') NOT NULL DEFAULT 'info',
  `context`    VARCHAR(100) DEFAULT NULL,
  `message`    TEXT NOT NULL,
  `meta`       JSON DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_level` (`level`),
  KEY `idx_context` (`context`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
