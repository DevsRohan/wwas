<?php
// ============================================================
// WWAS - Node.js API Client (HTTP wrapper for HF backend)
// All PHP → HF communication goes through this class
// Handles timeouts, errors, and response parsing
// ============================================================

if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

class NodeClient
{
    /**
     * Send a WhatsApp message via the HF Node.js engine.
     *
     * @param string      $phoneNumber  Normalized phone (digits only)
     * @param string      $message      Message text
     * @param string|null $leadId       PHP lead ID (for webhook correlation)
     * @param string|null $jobId        Unique job ID (for dedup)
     * @param bool        $useQueue     Whether to queue (true) or send immediately (false)
     * @param int         $delayMs      Queue delay in milliseconds
     * @return array{success: bool, queued?: bool, wa_message_id?: string, job_id?: string, error?: string}
     */
    public static function sendMessage(
        string $phoneNumber,
        string $message,
        ?string $leadId = null,
        ?string $jobId = null,
        bool $useQueue = true,
        int $delayMs = 0
    ): array {
        $payload = [
            'phone'        => $phoneNumber,           // Node expects 'phone' not 'phone_number'
            'message'      => $message,
            'leadId'       => $leadId,                // Node expects 'leadId' not 'lead_id'
            'immediate'    => !$useQueue,             // Node expects 'immediate' not 'use_queue'
        ];

        // Add delay overrides only if provided (in seconds — Node converts internally)
        if ($delayMs > 0) {
            $payload['delayMin'] = (int) ($delayMs / 1000);
            $payload['delayMax'] = (int) ($delayMs / 1000);
        }

        return self::post('/send-message', $payload);
    }

    /**
     * Check if a single phone number is registered on WhatsApp.
     *
     * @param string $phoneNumber  Normalized phone
     * @return array{success: bool, phone?: string, status?: string, registered?: bool, error?: string}
     */
    public static function checkNumber(string $phoneNumber): array
    {
        // Node expects 'phone' not 'phone_number'
        return self::post('/check-number', ['phone' => $phoneNumber]);
    }

    /**
     * Validate a batch of phone numbers.
     * Returns results array with status per number.
     *
     * @param array $phoneNumbers  Array of normalized phone numbers
     * @return array{success: bool, results?: array, summary?: array, error?: string}
     */
    public static function checkNumbers(array $phoneNumbers): array
    {
        if (empty($phoneNumbers)) {
            return ['success' => false, 'error' => 'No phone numbers provided'];
        }
        // Node expects 'phones' not 'phone_numbers'
        return self::post('/check-number', ['phones' => array_values($phoneNumbers)]);
    }

    /**
     * Get the health/status of the HF Node.js engine.
     *
     * @return array{status?: string, whatsapp?: array, queue?: array, error?: string}
     */
    public static function getHealth(): array
    {
        // withAuth = true — Node /health requires X-API-Key
        return self::get('/health', true);
    }

    /**
     * Get the current WhatsApp QR code (if awaiting scan).
     *
     * @return array{success: bool, qr?: string, qr_available?: bool, error?: string}
     */
    public static function getQR(): array
    {
        return self::get('/whatsapp/qr', true);
    }

    /**
     * Get the WhatsApp connection status.
     *
     * @return array
     */
    public static function getWaStatus(): array
    {
        return self::get('/whatsapp/status', true);
    }

    /**
     * Pause the outbound queue.
     *
     * @return array
     */
    public static function pauseQueue(): array
    {
        return self::post('/queue/pause', []);
    }

    /**
     * Resume the outbound queue.
     *
     * @return array
     */
    public static function resumeQueue(): array
    {
        return self::post('/queue/resume', []);
    }

    /**
     * Clear/stop the outbound queue.
     *
     * @return array
     */
    public static function clearQueue(): array
    {
        // Node endpoint is /queue/stop (clears and stops the queue)
        return self::post('/queue/stop', []);
    }

    /**
     * Get queue state.
     *
     * @return array
     */
    public static function getQueueState(): array
    {
        return self::get('/queue/state', true);
    }

    // ============================================================
    // PRIVATE HTTP HELPERS
    // ============================================================

    /**
     * Make an authenticated POST request to the HF backend.
     *
     * @param string $endpoint  e.g. '/send-message'
     * @param array  $payload
     * @return array
     */
    private static function post(string $endpoint, array $payload): array
    {
        return self::request('POST', $endpoint, $payload);
    }

    /**
     * Make an authenticated GET request to the HF backend.
     *
     * @param string $endpoint
     * @param bool   $requireAuth  Whether to send API key (health endpoint doesn't need it)
     * @return array
     */
    private static function get(string $endpoint, bool $requireAuth = false): array
    {
        return self::request('GET', $endpoint, [], $requireAuth);
    }

    /**
     * Core HTTP request handler using cURL.
     *
     * @param string $method
     * @param string $endpoint
     * @param array  $payload
     * @param bool   $withAuth
     * @return array
     */
    private static function request(string $method, string $endpoint, array $payload = [], bool $withAuth = true): array
    {
        $apiUrl = rtrim(getSetting('hf_api_url', HF_API_URL), '/');
        $apiKey = getSetting('hf_api_key', HF_API_KEY);

        if (empty($apiUrl)) {
            return ['success' => false, 'error' => 'HF API URL not configured'];
        }

        $url = $apiUrl . $endpoint;

        // Build headers
        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
            'User-Agent: WWAS-PHP/1.0'
        ];

        if ($withAuth && !empty($apiKey)) {
            $headers[] = 'X-API-Key: ' . $apiKey;
        }

        $ch = curl_init($url);
        $curlOpts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => HF_REQUEST_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => HF_CONNECT_TIMEOUT,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_FOLLOWLOCATION => false
        ];

        if ($method === 'POST') {
            $curlOpts[CURLOPT_POST]       = true;
            $curlOpts[CURLOPT_POSTFIELDS] = json_encode($payload);
        }

        curl_setopt_array($ch, $curlOpts);

        $responseBody = curl_exec($ch);
        $httpCode     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError    = curl_error($ch);
        curl_close($ch);

        // cURL connection error
        if ($curlError) {
            AppLogger::error('NodeClient cURL error', [
                'endpoint' => $endpoint,
                'error'    => $curlError
            ]);
            return ['success' => false, 'error' => 'Connection error: ' . $curlError];
        }

        // Parse JSON response
        $decoded = json_decode($responseBody, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            AppLogger::error('NodeClient JSON parse error', [
                'endpoint'  => $endpoint,
                'http_code' => $httpCode,
                'body'      => substr($responseBody, 0, 200)
            ]);
            return ['success' => false, 'error' => "Invalid JSON response (HTTP {$httpCode})"];
        }

        // HTTP error
        if ($httpCode < 200 || $httpCode >= 300) {
            $errMsg = $decoded['error'] ?? "HTTP {$httpCode}";
            AppLogger::warning('NodeClient HTTP error', [
                'endpoint'  => $endpoint,
                'http_code' => $httpCode,
                'error'     => $errMsg
            ]);
            return array_merge(['success' => false], $decoded ?? ['error' => $errMsg]);
        }

        return $decoded ?? ['success' => true];
    }
}
