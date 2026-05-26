<?php
// ============================================================
// WWAS - PDO Database Connection
// Singleton pattern — one connection per request lifecycle
// Optimized for Hostinger shared hosting
// ============================================================

if (!defined('WWAS_LOADED')) {
    http_response_code(403);
    exit('Direct access forbidden');
}

class Database
{
    /** @var PDO|null */
    private static ?PDO $instance = null;

    /**
     * Get the singleton PDO instance.
     * Creates connection on first call, reuses thereafter.
     *
     * @throws RuntimeException if connection fails
     * @return PDO
     */
    public static function getInstance(): PDO
    {
        if (self::$instance === null) {
            self::$instance = self::createConnection();
        }
        return self::$instance;
    }

    /**
     * Create a new PDO connection with production-safe settings.
     *
     * @return PDO
     * @throws RuntimeException
     */
    private static function createConnection(): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            DB_HOST,
            DB_PORT,
            DB_NAME,
            DB_CHARSET
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,     // Use real prepared statements
            PDO::ATTR_PERSISTENT         => false,     // No persistent connections on shared hosting
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone='+05:30'",
        ];

        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
            return $pdo;
        } catch (PDOException $e) {
            // Log connection error without exposing credentials
            $safeMessage = 'Database connection failed';
            if (defined('LOG_ENABLED') && LOG_ENABLED && defined('LOG_FILE')) {
                $entry = sprintf(
                    "[%s] [error] [DB] %s: %s\n",
                    date('Y-m-d H:i:s'),
                    $safeMessage,
                    $e->getMessage()
                );
                @file_put_contents(LOG_FILE, $entry, FILE_APPEND | LOCK_EX);
            }
            throw new RuntimeException($safeMessage . '. Please check your database configuration.');
        }
    }

    /**
     * Get PDO shorthand — db() in global context
     */
    public static function pdo(): PDO
    {
        return self::getInstance();
    }

    /**
     * Execute a query and return all rows
     *
     * @param string $sql
     * @param array  $params
     * @return array
     */
    public static function fetchAll(string $sql, array $params = []): array
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * Execute a query and return a single row
     *
     * @param string $sql
     * @param array  $params
     * @return array|null
     */
    public static function fetchOne(string $sql, array $params = []): ?array
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Execute a query and return the value of the first column of the first row
     *
     * @param string $sql
     * @param array  $params
     * @return mixed|null
     */
    public static function fetchValue(string $sql, array $params = [])
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        $value = $stmt->fetchColumn();
        return ($value !== false) ? $value : null;
    }

    /**
     * Execute a DML statement (INSERT / UPDATE / DELETE)
     * Returns number of affected rows
     *
     * @param string $sql
     * @param array  $params
     * @return int
     */
    public static function execute(string $sql, array $params = []): int
    {
        $stmt = self::getInstance()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    /**
     * Get the last inserted auto-increment ID
     *
     * @return string
     */
    public static function lastInsertId(): string
    {
        return self::getInstance()->lastInsertId();
    }

    /**
     * Begin a transaction
     */
    public static function beginTransaction(): void
    {
        self::getInstance()->beginTransaction();
    }

    /**
     * Commit a transaction
     */
    public static function commit(): void
    {
        self::getInstance()->commit();
    }

    /**
     * Roll back a transaction
     */
    public static function rollback(): void
    {
        if (self::getInstance()->inTransaction()) {
            self::getInstance()->rollBack();
        }
    }

    /**
     * Close connection (useful for long-running scripts/crons)
     */
    public static function close(): void
    {
        self::$instance = null;
    }

    // Prevent instantiation and cloning
    private function __construct() {}
    private function __clone() {}
}

/**
 * Global shorthand function for getting PDO instance
 * Usage: db()->prepare(...)  or  Database::fetchAll(...)
 *
 * @return PDO
 */
function db(): PDO
{
    return Database::getInstance();
}
