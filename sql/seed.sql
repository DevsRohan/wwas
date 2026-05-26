-- ============================================================
-- WWAS WhatsApp CRM - Seed Data
-- Default settings and admin user
-- ============================================================

-- Default Admin User (password: Admin@1234 - CHANGE IMMEDIATELY)
INSERT INTO `admin_users` (`username`, `password_hash`, `email`) VALUES
('admin', '$2y$12$zI3lFel8PzOCRJjIkSo3Y.KKhkz5RRCqJgu5vszF2ubwFM1DcZt6e', 'admin@example.com');

-- Default Settings
INSERT INTO `settings` (`key_name`, `key_value`) VALUES
('groq_api_key',        ''),
('hf_api_url',          'https://your-space.hf.space'),
('hf_api_key',          ''),
('webhook_secret',      ''),
('socket_url',          'https://your-space.hf.space'),
('delay_min',           '120'),
('delay_max',           '300'),
('daily_send_limit',    '50'),
('max_retries',         '3'),
('retry_delay',         '600'),
('campaign_status',     'idle'),
('app_name',            'WWAS'),
('app_tagline',         'WhatsApp Outreach OS'),
('notification_sound',  '1'),
('dark_mode',           '0'),
('logging_enabled',     '1'),
('groq_model',          'llama3-70b-8192'),
('groq_temperature',    '0.7'),
('groq_max_tokens',     '600'),
('version',             '1.0.0');
