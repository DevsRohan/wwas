<?php
// ============================================================
// WWAS - Groq AI Integration & Personalization Engine
// Generates highly personalized first outreach messages
// using Groq's llama3-70b-8192 model
// ============================================================

if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

class GroqAI
{
    // ── Service Selection Matrix ──────────────────────────────
    private const SERVICES_WITH_WEBSITE = [
        'AI Automation Systems',
        'WhatsApp CRM & Chatbots',
        'Conversion Optimization',
        'Custom Web Applications',
        'Digital Marketing & SEO',
        'eCommerce Growth Systems',
        'Marketing Funnel Design',
        'Chrome Extensions',
    ];

    private const SERVICES_WITHOUT_WEBSITE = [
        'Business Website Design',
        'Mobile-First Landing Pages',
        'eCommerce Store Setup',
        'Local Business Website',
        'Digital Presence & SEO',
        'WhatsApp Enquiry System',
        'Android Mobile App',
        'Digital Marketing Setup',
    ];

    // ── Language Instruction Map ──────────────────────────────
    private const LANGUAGE_INSTRUCTIONS = [
        'hinglish' => 'Write in natural Hinglish (Hindi + English mix in Roman script). Use casual, warm, respectful tone. Mix Hindi words naturally like "Aapka", "kafi", "accha", "kaam", "local log", "baat karte hain". Do NOT use Devanagari script.',
        'gujarati' => 'Write in polished English with a few warm Gujarati-friendly phrases. Tone should feel familiar and businesslike. You may use phrases like "Kem cho", or reference "vyapar" naturally once.',
        'marathi'  => 'Write in conversational English with a warm Marathi undertone. Tone should feel like a local professional colleague. Keep it friendly and direct.',
        'punjabi'  => 'Write in easy English with a warm Punjabi-friendly tone. Can use "Ji" for respect. Keep it energetic and direct.',
        'tamil'    => 'Write in clear, polished formal English. Professional and respectful tone appropriate for South Indian business culture.',
        'telugu'   => 'Write in clear, professional English. Respectful and direct tone.',
        'kannada'  => 'Write in professional English. Warm yet concise tone.',
        'bengali'  => 'Write in warm, conversational English. Respectful and professional.',
        'english'  => 'Write in clean, simple business English. Warm, professional, and direct.',
    ];

    /**
     * Generate a personalized first outreach message for a lead.
     *
     * @param array $lead  Lead data from DB
     * @return array{success: bool, message?: string, error?: string}
     */
    public static function generateMessage(array $lead): array
    {
        $apiKey = getSetting('groq_api_key', GROQ_API_KEY);

        if (empty($apiKey)) {
            AppLogger::error('Groq API key not configured', ['context' => 'GroqAI']);
            return ['success' => false, 'error' => 'Groq API key not configured'];
        }

        $prompt = self::buildPrompt($lead);
        $result = self::callGroqAPI($prompt, $apiKey);

        if (!$result['success']) {
            AppLogger::error('Groq API call failed', ['lead_id' => $lead['id'] ?? 0, 'error' => $result['error']]);
            return $result;
        }

        $message = self::cleanMessage($result['message']);

        AppLogger::info('Groq message generated', [
            'lead_id'    => $lead['id'] ?? 0,
            'pitch_type' => $lead['pitch_type'] ?? 'B',
            'lang'       => $lead['language_pref'] ?? 'english',
            'chars'      => strlen($message)
        ]);

        return ['success' => true, 'message' => $message];
    }

    /**
     * Build the complete prompt for Groq.
     *
     * @param array $lead
     * @return array  [system, user] prompt pair
     */
    private static function buildPrompt(array $lead): array
    {
        $businessName = sanitizeString($lead['business_name'] ?? 'this business', 100);
        $locality     = sanitizeString($lead['locality'] ?? '', 80);
        $city         = sanitizeString($lead['city'] ?? '', 80);
        $state        = sanitizeString($lead['state'] ?? '', 80);
        $rating       = isset($lead['rating']) ? (float) $lead['rating'] : null;
        $reviewCount  = (int) ($lead['review_count'] ?? 0);
        $websiteUrl   = sanitizeString($lead['website_url'] ?? '', 300);
        $pitchType    = ($lead['pitch_type'] ?? 'B') === 'A' ? 'A' : 'B';
        $language     = $lead['language_pref'] ?? 'english';

        // Determine location display
        $locationParts = array_filter([$locality, $city, $state]);
        $location      = implode(', ', $locationParts) ?: ($city ?: 'your area');

        // Select 2 most relevant services
        $services = self::selectServices($pitchType, $lead);
        $servicesStr = implode(' and ', array_slice($services, 0, 2));

        // Language instruction
        $langInstruction = self::LANGUAGE_INSTRUCTIONS[$language] ?? self::LANGUAGE_INSTRUCTIONS['english'];

        // Build digital context
        if ($pitchType === 'A') {
            $digitalContext  = "The business has a website: {$websiteUrl}. Focus on: improving their digital systems, AI automation, WhatsApp CRM, conversion optimization, or scaling their online presence.";
            $opportunityAngle = "Their website exists but could be significantly improved with AI, automation, or better digital systems to convert more visitors and streamline operations.";
        } else {
            $digitalContext  = "The business does NOT have a website or any online presence.";
            $opportunityAngle = "They are missing out on digital customers entirely. A professional website, landing page, or WhatsApp enquiry system could immediately bring them more clients.";
        }

        // Rating context
        $ratingContext = '';
        if ($rating !== null && $reviewCount > 0) {
            $ratingContext = "They have {$rating} stars with {$reviewCount} Google reviews — showing they have established customer trust.";
        } elseif ($reviewCount > 0) {
            $ratingContext = "They have {$reviewCount} Google reviews showing active customer engagement.";
        }

        // ── System Prompt ─────────────────────────────────────
        $systemPrompt = <<<SYSTEM
You are a skilled Indian digital marketing consultant and business development professional. You help local Indian businesses grow their digital presence and automate their operations.

Your task is to write a personalized WhatsApp first-contact message on behalf of a web & digital services agency.

STRICT RULES:
- DO NOT mention any pricing, costs, or packages
- DO NOT use fake urgency phrases like "limited time offer" or "act now"
- DO NOT list all services — mention ONLY the 2 most relevant ones
- DO NOT sound like a spam message or a template
- DO NOT start with "Hi, I am..." or "Hello, My name is..."
- DO write 4-5 short paragraphs
- DO make the message feel handcrafted and personal
- DO reference the business by name naturally
- DO mention specific local observations (city/area/rating)
- DO end with a soft, natural CTA — not aggressive
- Message length: 150–250 words maximum

MESSAGE STRUCTURE (follow this):
1. A warm local trust observation about their business
2. A specific digital observation (website status / online presence)
3. The specific opportunity you see for them
4. The 1-2 relevant services that would help them most
5. Soft CTA: invite conversation, no pressure

{$langInstruction}
SYSTEM;

        // ── User Prompt ───────────────────────────────────────
        $userPrompt = <<<USER
Write a personalized first WhatsApp outreach message for this business:

Business Name: {$businessName}
Location: {$location}
{$ratingContext}
Digital Status: {$digitalContext}
Opportunity: {$opportunityAngle}
Most Relevant Services to Mention: {$servicesStr}

Remember: Sound like a real person reaching out, not a template. Make it feel like you specifically noticed their business. Keep it conversational and warm.
USER;

        return ['system' => trim($systemPrompt), 'user' => trim($userPrompt)];
    }

    /**
     * Select the 2 most relevant services based on pitch type and lead data.
     *
     * @param string $pitchType
     * @param array  $lead
     * @return array
     */
    private static function selectServices(string $pitchType, array $lead): array
    {
        $rating      = (float) ($lead['rating'] ?? 0);
        $reviewCount = (int)   ($lead['review_count'] ?? 0);
        $websiteUrl  = $lead['website_url'] ?? '';

        if ($pitchType === 'A') {
            // Has website
            if ($rating >= 4.0 && $reviewCount > 50) {
                // High reputation → scale with AI/automation
                return ['AI Automation Systems', 'WhatsApp CRM & Chatbots'];
            }
            if ($rating < 4.0 && $reviewCount > 0) {
                // Lower rating → marketing & conversion
                return ['Digital Marketing & SEO', 'Conversion Optimization'];
            }
            if (stripos($websiteUrl, 'shop') !== false || stripos($websiteUrl, 'store') !== false) {
                // eCommerce signals
                return ['eCommerce Growth Systems', 'Marketing Funnel Design'];
            }
            return ['AI Automation Systems', 'Custom Web Applications'];
        }

        // No website (Type B)
        if ($reviewCount > 30) {
            // Has reviews but no website → high opportunity
            return ['Business Website Design', 'WhatsApp Enquiry System'];
        }
        if ($reviewCount > 0) {
            return ['Mobile-First Landing Pages', 'Digital Marketing Setup'];
        }
        return ['Local Business Website', 'Digital Presence & SEO'];
    }

    /**
     * Call the Groq API with the given prompt.
     *
     * @param array  $prompt  [system, user]
     * @param string $apiKey
     * @return array{success: bool, message?: string, error?: string}
     */
    private static function callGroqAPI(array $prompt, string $apiKey): array
    {
        $model       = getSetting('groq_model', GROQ_MODEL);
        $temperature = (float) getSetting('groq_temperature', GROQ_TEMPERATURE);
        $maxTokens   = (int)   getSetting('groq_max_tokens', GROQ_MAX_TOKENS);

        $payload = json_encode([
            'model'       => $model,
            'temperature' => $temperature,
            'max_tokens'  => $maxTokens,
            'messages'    => [
                ['role' => 'system', 'content' => $prompt['system']],
                ['role' => 'user',   'content' => $prompt['user']]
            ]
        ]);

        $ch = curl_init(GROQ_API_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_TIMEOUT        => GROQ_TIMEOUT,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey
            ],
            CURLOPT_SSL_VERIFYPEER => true
        ]);

        $response   = curl_exec($ch);
        $httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError  = curl_error($ch);
        curl_close($ch);

        if ($curlError) {
            return ['success' => false, 'error' => 'cURL error: ' . $curlError];
        }

        if ($httpCode !== 200) {
            $decoded = json_decode($response, true);
            $errMsg  = $decoded['error']['message'] ?? "HTTP {$httpCode}";
            return ['success' => false, 'error' => 'Groq API error: ' . $errMsg];
        }

        $decoded = json_decode($response, true);
        $content = $decoded['choices'][0]['message']['content'] ?? null;

        if (empty($content)) {
            return ['success' => false, 'error' => 'Empty response from Groq API'];
        }

        return ['success' => true, 'message' => $content];
    }

    /**
     * Clean generated message — remove extra whitespace, trim.
     *
     * @param string $raw
     * @return string
     */
    private static function cleanMessage(string $raw): string
    {
        // Normalize line breaks
        $clean = str_replace(["\r\n", "\r"], "\n", $raw);
        // Collapse multiple blank lines into max 2
        $clean = preg_replace('/\n{3,}/', "\n\n", $clean);
        return trim($clean);
    }

    /**
     * Generate a fallback message when Groq is unavailable.
     * Still personalized but uses a local template.
     *
     * @param array $lead
     * @return string
     */
    public static function generateFallback(array $lead): string
    {
        $name     = sanitizeString($lead['business_name'] ?? 'your business', 80);
        $city     = sanitizeString($lead['city'] ?? 'your city', 60);
        $type     = ($lead['pitch_type'] ?? 'B') === 'A' ? 'website' : 'digital presence';
        $services = ($lead['pitch_type'] ?? 'B') === 'A'
            ? 'AI automation and WhatsApp CRM systems'
            : 'a professional website and digital marketing setup';

        return "Hi! I came across {$name} in {$city} and was really impressed by what you've built locally.\n\n"
            . "I noticed that your {$type} could be significantly upgraded to bring in more customers and streamline your operations.\n\n"
            . "We specialize in helping businesses like yours with {$services} — and I thought it could be a great fit.\n\n"
            . "Would love to understand your goals and share a few ideas that have worked well for similar businesses in {$city}.\n\n"
            . "Happy to have a quick chat if you're interested!";
    }
}
