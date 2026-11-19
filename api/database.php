<?php
declare(strict_types=1);

function config(): array
{
    static $config;
    if ($config !== null) {
        return $config;
    }

    $envFile = dirname(__DIR__) . '/.env';
    $values = is_file($envFile) ? parse_ini_file($envFile, false, INI_SCANNER_RAW) : [];
    $config = [
        'host' => getenv('DB_HOST') ?: ($values['DB_HOST'] ?? '127.0.0.1'),
        'port' => getenv('DB_PORT') ?: ($values['DB_PORT'] ?? '5432'),
        'database' => getenv('DB_DATABASE') ?: ($values['DB_DATABASE'] ?? 'hotel_reservations'),
        'username' => getenv('DB_USERNAME') ?: ($values['DB_USERNAME'] ?? 'postgres'),
        'password' => getenv('DB_PASSWORD') ?: ($values['DB_PASSWORD'] ?? ''),
    ];
    return $config;
}

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $settings = config();
    $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $settings['host'], $settings['port'], $settings['database']);
    $pdo = new PDO($dsn, $settings['username'], $settings['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}