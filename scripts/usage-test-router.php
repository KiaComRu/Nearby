<?php
// Test-only: actual landing files plus the source web app, all on loopback.
if (str_starts_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/web/')) {
    require __DIR__ . '/pwa-test-router.php';
    return true;
}
return false;
