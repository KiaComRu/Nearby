<?php
declare(strict_types=1);

function shortIdSecret(string $base): string {
    $handle = fopen($base . '/short-id-secret', 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) throw new RuntimeException('ID secret lock failed');
    try {
        $secret = stream_get_contents($handle);
        if ($secret === '') {
            $secret = bin2hex(random_bytes(32));
            if (fwrite($handle, $secret) !== 64 || !fflush($handle) || !chmod($base . '/short-id-secret', 0600)) throw new RuntimeException('ID secret write failed');
        }
        if (!preg_match('/^[a-f0-9]{64}$/D', $secret)) throw new RuntimeException('Invalid ID secret');
        return $secret;
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}
function shortIdToken(string $base, string $room): string {
    return hash_hmac('sha256', 'nearby-short-id:v1:invite:' . $room, shortIdSecret($base));
}
// The caller holds create.lock. Reservations avoid taking room locks in the
// opposite order from relay selection, and prevent reuse during the ID lifetime.
function reserveShortId(string $base, int $now): array {
    $handle = fopen($base . '/short-id-reservations.json', 'c+');
    if (!$handle) throw new RuntimeException('ID reservations unavailable');
    try {
        $raw = stream_get_contents($handle);
        $entries = $raw === '' ? [] : json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        if (!is_array($entries)) throw new RuntimeException('Invalid ID reservations');
        foreach ($entries as $lookup => $expires) {
            if (!is_int($expires)) throw new RuntimeException('Invalid ID reservation expiry');
            if ($expires < $now) unset($entries[$lookup]);
        }
        if (count($entries) >= 5000) fail(503, 'Сервис занят. Попробуйте позже.');
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $code = str_pad((string)random_int(0, 999999999), 9, '0', STR_PAD_LEFT);
            $lookup = hash('sha256', 'nearby-short-id:v1:lookup:' . $code);
            if (isset($entries[$lookup])) continue;
            $entries[$lookup] = $now + 900; writeState($handle, $entries);
            return [$code, $lookup];
        }
        throw new RuntimeException('ID allocation failed');
    } finally { fclose($handle); }
}
function idPublicKey(mixed $value): string {
    if (!is_string($value) || !preg_match('/^04[a-f0-9]{128}$/D', $value)) fail(400, 'Некорректный ключ устройства. Создайте новое приглашение.');
    return $value;
}
function idLookupBudget(string $base, int $now): void {
    $handle = fopen($base . '/id-lookup-budget.json', 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) throw new RuntimeException('ID budget lock failed');
    try {
        $raw = stream_get_contents($handle);
        $budget = $raw === '' ? ['window' => $now, 'requests' => 0] : json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        if (!is_array($budget) || !is_int($budget['window'] ?? null) || !is_int($budget['requests'] ?? null) || $budget['requests'] < 0) throw new RuntimeException('Invalid ID budget');
        if ($now - $budget['window'] >= 60) $budget = ['window' => $now, 'requests' => 0];
        $budget['requests']++; writeState($handle, $budget);
        if ($budget['requests'] > 120) fail(429, 'Слишком много попыток ввода ID. Подождите минуту.');
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}
