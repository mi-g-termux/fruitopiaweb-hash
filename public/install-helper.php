<?php
/**
 * Fruitopia — Universal Install Helper
 * 
 * Receives Firebase credentials from the InstallWizard,
 * writes firebase-config.json to the server root, then
 * locks itself with install-helper.lock.
 *
 * Works on any cPanel / shared hosting / VPS with PHP 7.4+
 */

// ── CORS headers — must be sent before ANY output ───────────────────────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');
header('Content-Type: application/json; charset=utf-8');

// ── Handle OPTIONS preflight immediately ─────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Helper: send JSON response and exit ──────────────────────────────────────
function respond(bool $success, string $message, int $httpCode = 200): void {
    http_response_code($httpCode);
    echo json_encode([
        'success' => $success,
        'message' => $message,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

// ── File paths (same directory as this script) ───────────────────────────────
$scriptDir   = __DIR__;
$configFile  = $scriptDir . DIRECTORY_SEPARATOR . 'firebase-config.json';
$lockFile    = $scriptDir . DIRECTORY_SEPARATOR . 'install-helper.lock';

// ── Lock check — if already installed, refuse ────────────────────────────────
if (file_exists($lockFile)) {
    respond(false, 'Already installed. Lock file exists. Remove install-helper.lock to reinstall.', 403);
}

// ── Only accept POST ─────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Method not allowed. Send a POST request with JSON body.', 405);
}

// ── Read raw POST body ───────────────────────────────────────────────────────
$rawBody = file_get_contents('php://input');
if (empty($rawBody)) {
    respond(false, 'Request body is empty. Send Firebase credentials as JSON.', 400);
}

// ── Decode JSON ──────────────────────────────────────────────────────────────
$data = json_decode($rawBody, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    respond(false, 'Invalid JSON: ' . json_last_error_msg(), 400);
}

// ── Required fields ──────────────────────────────────────────────────────────
$requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];

foreach ($requiredFields as $field) {
    if (!isset($data[$field]) || !is_string($data[$field]) || trim($data[$field]) === '') {
        respond(false, "Missing or empty required field: \"{$field}\". All Firebase credentials are required.", 400);
    }
}

// ── Validate apiKey format (Firebase keys start with "AIza") ─────────────────
$apiKey = trim($data['apiKey']);
if (strpos($apiKey, 'AIza') !== 0) {
    respond(false, 'Invalid apiKey format. Firebase API keys begin with "AIza". Check your Firebase project settings.', 400);
}

// ── Build the config object to write ─────────────────────────────────────────
$configData = [
    'apiKey'            => trim($data['apiKey']),
    'authDomain'        => trim($data['authDomain']),
    'projectId'         => trim($data['projectId']),
    'storageBucket'     => trim($data['storageBucket']),
    'messagingSenderId' => trim($data['messagingSenderId']),
    'appId'             => trim($data['appId']),
];

// Optional databaseId field
if (isset($data['databaseId']) && is_string($data['databaseId']) && trim($data['databaseId']) !== '') {
    $configData['databaseId'] = trim($data['databaseId']);
}

// ── Write firebase-config.json ───────────────────────────────────────────────
$jsonOutput = json_encode($configData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if ($jsonOutput === false) {
    respond(false, 'Failed to encode config as JSON: ' . json_last_error_msg(), 500);
}

$writeResult = file_put_contents($configFile, $jsonOutput, LOCK_EX);

if ($writeResult === false) {
    respond(
        false,
        'Failed to write firebase-config.json. Check that the web server has write permission to the public_html directory. ' .
        'On cPanel: File Manager → public_html → right-click → Change Permissions → set to 755.',
        500
    );
}

// ── Write lock file to prevent re-running ────────────────────────────────────
$lockContent = json_encode([
    'lockedAt'  => date('c'),          // ISO 8601 timestamp
    'projectId' => $configData['projectId'],
    'message'   => 'Fruitopia installation complete. Delete this file to allow reinstallation.',
], JSON_PRETTY_PRINT);

file_put_contents($lockFile, $lockContent, LOCK_EX);

// ── Success ──────────────────────────────────────────────────────────────────
respond(true, 'Firebase configuration saved successfully. firebase-config.json written to server root.');
