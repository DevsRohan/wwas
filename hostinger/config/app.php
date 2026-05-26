<?php
// ============================================================
// WWAS - Application Configuration
// Central config file - all constants defined here
// Update these values after deployment
// ============================================================

// Prevent direct access
if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

// ============================================================
// APPLICATION IDENTITY
// ============================================================
define('APP_NAME',       'WWAS');
define('APP_TAGLINE',    'WhatsApp Outreach OS');
define('APP_VERSION',    '1.0.0');
define('APP_ENV',        getenv('APP_ENV') ?: 'production'); // 'production' | 'development'
define('APP_DEBUG',      APP_ENV === 'development');
define('APP_TIMEZONE',   'Asia/Kolkata');

// Set timezone globally
date_default_timezone_set(APP_TIMEZONE);

// ============================================================
// DATABASE CONFIGURATION
// Set via environment variables OR hardcode for Hostinger
// ============================================================
define('DB_HOST',     getenv('DB_HOST')     ?: 'localhost');
define('DB_PORT',     getenv('DB_PORT')     ?: '3306');
define('DB_NAME',     getenv('DB_NAME')     ?: 'your_database_name');
define('DB_USER',     getenv('DB_USER')     ?: 'your_database_user');
define('DB_PASS',     getenv('DB_PASS')     ?: 'your_database_password');
define('DB_CHARSET',  'utf8mb4');

// ============================================================
// HUGGING FACE NODE.JS BACKEND
// ============================================================
define('HF_API_URL',  rtrim(getenv('HF_API_URL') ?: 'https://your-space.hf.space', '/'));
define('HF_API_KEY',  getenv('HF_API_KEY')  ?: '');

// Socket.io URL for frontend to connect (usually same as HF_API_URL)
define('SOCKET_URL',  rtrim(getenv('SOCKET_URL') ?: HF_API_URL, '/'));

// ============================================================
// WEBHOOK SECURITY
// Must match WEBHOOK_SECRET in HF .env
// ============================================================
define('WEBHOOK_SECRET', getenv('WEBHOOK_SECRET') ?: '');

// ============================================================
// GROQ AI CONFIGURATION
// ============================================================
define('GROQ_API_KEY',      getenv('GROQ_API_KEY')      ?: '');
define('GROQ_API_URL',      'https://api.groq.com/openai/v1/chat/completions');
define('GROQ_MODEL',        'llama3-70b-8192');
define('GROQ_TEMPERATURE',  0.7);
define('GROQ_MAX_TOKENS',   600);
define('GROQ_TIMEOUT',      30); // seconds

// ============================================================
// CAMPAIGN SETTINGS (defaults, overridable via settings table)
// ============================================================
define('CAMPAIGN_DELAY_MIN',    120);   // seconds between sends (min)
define('CAMPAIGN_DELAY_MAX',    300);   // seconds between sends (max)
define('CAMPAIGN_DAILY_LIMIT',  50);    // max sends per day
define('CAMPAIGN_MAX_RETRIES',  3);     // failed send retry limit
define('CAMPAIGN_RETRY_DELAY',  600);   // seconds before retrying

// ============================================================
// SECURITY
// ============================================================
define('SESSION_NAME',     'wwas_session');
define('SESSION_LIFETIME', 86400);      // 24 hours in seconds
define('CSRF_TOKEN_NAME',  'wwas_csrf');

// API response headers
define('JSON_CONTENT_TYPE', 'application/json; charset=utf-8');

// ============================================================
// FILE PATHS
// ============================================================
define('BASE_PATH',    dirname(__DIR__));          // hostinger/ root
define('UPLOAD_PATH',  BASE_PATH . '/uploads/csv');
define('LOG_PATH',     BASE_PATH . '/logs');
define('CONFIG_PATH',  BASE_PATH . '/config');
define('INCLUDES_PATH', BASE_PATH . '/includes');

// Maximum CSV upload size (10 MB)
define('MAX_CSV_SIZE', 10 * 1024 * 1024);

// ============================================================
// LOGGING
// ============================================================
define('LOG_ENABLED',  true);
define('LOG_FILE',     LOG_PATH . '/app.log');
define('WEBHOOK_LOG',  LOG_PATH . '/webhook.log');

// ============================================================
// FEATURE FLAGS
// ============================================================
define('FEATURE_GROQ_ENABLED',       true);
define('FEATURE_VALIDATION_ENABLED', true);
define('FEATURE_CAMPAIGN_ENABLED',   true);
define('FEATURE_LOGS_ENABLED',       true);

// ============================================================
// HF API REQUEST DEFAULTS
// ============================================================
define('HF_REQUEST_TIMEOUT',  15);  // seconds
define('HF_CONNECT_TIMEOUT',  10);  // seconds
