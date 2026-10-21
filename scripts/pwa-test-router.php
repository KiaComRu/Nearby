<?php
// Loopback-only fixture for /web/ scope and production-style CSP; never deploy.
$base = realpath(__DIR__ . '/../browser');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (!str_starts_with($path, '/web/')) { http_response_code(404); exit; }
$name = substr($path, strlen('/web/')) ?: 'index.html';
$allowed = ['index.html','app.js','metrika.js','metrika.css','file-presentation.js','file-presentation.css','styles.css','workspace.css','tabs.js','localize.js','localize.css','pwa.js','pwa.css','manifest.webmanifest','sw.js','offline.html','pwa-offline.js','pwa-offline.css','transfer.mjs','probe-channel.mjs','relay.mjs','invitation-id.mjs','connection.mjs','statistics.js','api.php','favicon.svg','favicon.ico','apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png','vendor/qrcode.js'];
if (!in_array($name, $allowed, true) && !preg_match('/^app-\d+\.\d+\.\d+\.js$/D', $name)) { http_response_code(404); exit; }
$config = file_get_contents($base . '/.htaccess');
if (preg_match('/^Header always set Content-Security-Policy "([^"]+)"/m', $config, $matches)) header('Content-Security-Policy: ' . $matches[1]);
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
if ($name === 'api.php') { require $base . '/api.php'; exit; }
$types = ['html'=>'text/html; charset=utf-8','js'=>'text/javascript; charset=utf-8','mjs'=>'text/javascript; charset=utf-8','css'=>'text/css; charset=utf-8','webmanifest'=>'application/manifest+json','png'=>'image/png','svg'=>'image/svg+xml','ico'=>'image/x-icon'];
header('Content-Type: ' . ($types[pathinfo($name, PATHINFO_EXTENSION)] ?? 'application/octet-stream'));
$body = file_get_contents($base . '/' . $name);
if ($name === 'sw.js') {
    header('Cache-Control: no-cache');
    $revisionFile = getenv('NEARBY_PWA_TEST_REVISION_FILE');
    if ($revisionFile && is_file($revisionFile)) $body .= "\n// Test-only revision " . (int) file_get_contents($revisionFile);
}
echo $body;
