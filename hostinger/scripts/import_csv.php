<?php
// ============================================================
// WWAS - CSV Import Script
// Handles CSV upload, parsing, normalization, and DB insert
// Called via AJAX from dashboard (multipart/form-data POST)
// ============================================================

define('WWAS_LOADED', true);
require_once __DIR__ . '/../config/app.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../includes/helpers.php';
require_once __DIR__ . '/../includes/auth.php';

// Must be logged in
if (!isLoggedIn()) {
    apiUnauthorized();
}

requirePost();

// ── Validate uploaded file ────────────────────────────────────
if (!isset($_FILES['csv_file']) || $_FILES['csv_file']['error'] !== UPLOAD_ERR_OK) {
    $uploadError = $_FILES['csv_file']['error'] ?? 99;
    $errorMessages = [
        UPLOAD_ERR_INI_SIZE   => 'File exceeds server upload limit',
        UPLOAD_ERR_FORM_SIZE  => 'File exceeds form size limit',
        UPLOAD_ERR_PARTIAL    => 'File was only partially uploaded',
        UPLOAD_ERR_NO_FILE    => 'No file was uploaded',
        UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder',
        UPLOAD_ERR_CANT_WRITE => 'Failed to write file to disk',
        UPLOAD_ERR_EXTENSION  => 'Upload blocked by server extension',
    ];
    jsonError($errorMessages[$uploadError] ?? 'File upload failed', 400);
}

$file = $_FILES['csv_file'];

// Validate file size
if ($file['size'] > MAX_CSV_SIZE) {
    jsonError('File size exceeds maximum allowed size of 10MB', 400);
}

// Validate MIME type
$finfo    = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($file['tmp_name']);
if (!in_array($mimeType, ['text/plain', 'text/csv', 'application/csv', 'application/vnd.ms-excel'], true)) {
    jsonError('Invalid file type. Only CSV files are allowed.', 400);
}

// Validate file extension
$ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
if (!in_array($ext, ['csv', 'txt'], true)) {
    jsonError('Invalid file extension. Only .csv files are allowed.', 400);
}

// ── Save uploaded file ────────────────────────────────────────
if (!is_dir(UPLOAD_PATH)) {
    mkdir(UPLOAD_PATH, 0755, true);
}

$savedName = 'import_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.csv';
$savedPath = UPLOAD_PATH . '/' . $savedName;

if (!move_uploaded_file($file['tmp_name'], $savedPath)) {
    jsonError('Failed to save uploaded file. Check directory permissions.', 500);
}

// ── Parse and import CSV ──────────────────────────────────────
$results = importCsv($savedPath);

// Clean up uploaded file after import
@unlink($savedPath);

AppLogger::db('info', 'CSV Import', 'CSV import completed', [
    'file'      => $file['name'],
    'total'     => $results['total'],
    'imported'  => $results['imported'],
    'skipped'   => $results['skipped'],
    'errors'    => $results['error_count']
]);

jsonSuccess($results);

// ============================================================
// IMPORT FUNCTION
// ============================================================

/**
 * Parse CSV file and import records into the leads table.
 *
 * @param string $filePath
 * @return array  Import statistics
 */
function importCsv(string $filePath): array
{
    $stats = [
        'total'       => 0,
        'imported'    => 0,
        'skipped'     => 0,
        'error_count' => 0,
        'errors'      => [],
        'duplicates'  => 0
    ];

    $handle = fopen($filePath, 'r');
    if (!$handle) {
        return array_merge($stats, ['errors' => ['Cannot open file for reading']]);
    }

    // Detect delimiter (comma or semicolon)
    $firstLine = fgets($handle);
    rewind($handle);
    $delimiter = (substr_count($firstLine, ';') > substr_count($firstLine, ',')) ? ';' : ',';

    // Read header row
    $headers = fgetcsv($handle, 0, $delimiter);
    if ($headers === false) {
        fclose($handle);
        return array_merge($stats, ['errors' => ['CSV file is empty or has no headers']]);
    }

    // Normalize header names
    $headers = array_map(fn($h) => strtolower(trim(preg_replace('/[^a-z0-9_]/i', '_', $h))), $headers);

    // Build column index map (flexible CSV column names)
    $colMap = buildColumnMap($headers);

    // Prepare the INSERT statement
    $insertSql = '
        INSERT INTO leads
            (business_name, address, locality, city, state, phone_number,
             website_url, website_status, rating, review_count,
             pitch_type, language_pref, whatsapp_status, outreach_status)
        VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            updated_at = NOW()
    ';

    $rowNum = 1; // Start after header
    while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
        $rowNum++;
        $stats['total']++;

        // Skip completely empty rows
        if (empty(array_filter($row))) {
            $stats['skipped']++;
            continue;
        }

        // Map row values to column names
        $data = [];
        foreach ($headers as $idx => $colName) {
            $data[$colName] = isset($row[$idx]) ? trim($row[$idx]) : '';
        }

        // ── Extract fields ────────────────────────────────────
        $businessName = sanitizeString(
            $data[$colMap['name']] ?? ($data['business_name'] ?? ''),
            255
        );

        if (empty($businessName)) {
            $stats['skipped']++;
            $stats['errors'][] = "Row {$rowNum}: Missing business name";
            continue;
        }

        $rawPhone = $data[$colMap['phone']] ?? ($data['phone'] ?? '');
        $phone    = normalizePhone($rawPhone);

        if (empty($phone)) {
            $stats['skipped']++;
            $stats['errors'][] = "Row {$rowNum}: Invalid phone number '{$rawPhone}'";
            continue;
        }

        $address    = sanitizeString($data[$colMap['address']] ?? '', 500);
        $websiteRaw = sanitizeUrl($data[$colMap['website']] ?? '');
        $ratingRaw  = sanitizeString($data[$colMap['rating']] ?? '0');
        $reviewsRaw = sanitizeString($data[$colMap['reviews']] ?? '0');

        // Parse rating (handle "4.2 stars" format)
        $rating = null;
        if (!empty($ratingRaw)) {
            preg_match('/(\d+\.?\d*)/', $ratingRaw, $m);
            if (!empty($m[1])) {
                $rVal = (float) $m[1];
                $rating = ($rVal >= 0 && $rVal <= 5) ? $rVal : null;
            }
        }

        // Parse review count (handle "127 reviews" format)
        $reviewCount = 0;
        if (!empty($reviewsRaw)) {
            preg_match('/(\d+)/', $reviewsRaw, $m);
            $reviewCount = (int) ($m[1] ?? 0);
        }

        // Parse address into components
        $addrParts = parseAddress($address);
        $locality  = $addrParts['locality'];
        $city      = $addrParts['city'];
        $state     = $addrParts['state'];

        // Override with explicit city/state columns if present
        if (!empty($data[$colMap['city']] ?? ''))  $city  = sanitizeString($data[$colMap['city']], 100);
        if (!empty($data[$colMap['state']] ?? '')) $state = sanitizeString($data[$colMap['state']], 100);

        // Determine pitch type and website status
        $websiteStatus = (!empty($websiteRaw)) ? 'yes' : 'no';
        $pitchType     = getPitchType($websiteRaw);
        $languagePref  = getLanguageFromState($state);

        // ── Insert into DB ────────────────────────────────────
        try {
            $affected = Database::execute($insertSql, [
                $businessName,
                $address,
                $locality,
                $city,
                $state,
                $phone,
                $websiteRaw ?: null,
                $websiteStatus,
                $rating,
                $reviewCount,
                $pitchType,
                $languagePref,
                'pending',  // whatsapp_status
                'pending'   // outreach_status
            ]);

            if ($affected === 0) {
                // ON DUPLICATE KEY fired — record existed
                $stats['duplicates']++;
                $stats['skipped']++;
            } else {
                $stats['imported']++;
            }

        } catch (PDOException $e) {
            $stats['error_count']++;
            // Only record first 20 errors to avoid huge response
            if (count($stats['errors']) < 20) {
                $stats['errors'][] = "Row {$rowNum}: DB error - " . $e->getMessage();
            }
            AppLogger::error('CSV import row error', [
                'row'   => $rowNum,
                'phone' => $phone,
                'error' => $e->getMessage()
            ]);
        }

        // Limit max records per import to prevent memory issues on shared hosting
        if ($stats['total'] >= 5000) {
            $stats['errors'][] = 'Import stopped at 5000 rows (maximum per import)';
            break;
        }
    }

    fclose($handle);

    return $stats;
}

/**
 * Build a flexible column index map from CSV headers.
 * Handles various column naming conventions.
 *
 * @param array $headers  Normalized lowercase header names
 * @return array  Map of field => header_key
 */
function buildColumnMap(array $headers): array
{
    $map = [
        'name'    => '',
        'phone'   => '',
        'address' => '',
        'website' => '',
        'rating'  => '',
        'reviews' => '',
        'city'    => '',
        'state'   => ''
    ];

    foreach ($headers as $h) {
        if (str_contains($h, 'name') || str_contains($h, 'business'))  $map['name']    = $h;
        if (str_contains($h, 'phone') || str_contains($h, 'mobile') || str_contains($h, 'contact')) $map['phone'] = $h;
        if (str_contains($h, 'address') || str_contains($h, 'location')) $map['address'] = $h;
        if (str_contains($h, 'website') || str_contains($h, 'url') || str_contains($h, 'web')) $map['website'] = $h;
        if (str_contains($h, 'rating') || str_contains($h, 'star'))    $map['rating']  = $h;
        if (str_contains($h, 'review') || str_contains($h, 'count') || str_contains($h, 'feedback')) $map['reviews'] = $h;
        if ($h === 'city')   $map['city']  = $h;
        if ($h === 'state')  $map['state'] = $h;
    }

    // Fallback: use positional mapping for unknown headers
    if (empty($map['name'])  && isset($headers[0])) $map['name']    = $headers[0];
    if (empty($map['phone']) && isset($headers[2])) $map['phone']   = $headers[2];
    if (empty($map['address']) && isset($headers[1])) $map['address'] = $headers[1];

    return $map;
}
