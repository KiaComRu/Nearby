<?php
declare(strict_types=1);

function localStatisticsSecret(string $base): string {
    $file = fopen($base . '/statistics-secret', 'c+');
    if (!$file || !flock($file, LOCK_EX)) throw new RuntimeException('Statistics secret lock failed');
    try {
        $secret = stream_get_contents($file);
        if ($secret === '') {
            $secret = bin2hex(random_bytes(32));
            if (fwrite($file, $secret) !== strlen($secret) || !fflush($file)) throw new RuntimeException('Statistics secret save failed');
            chmod($base . '/statistics-secret', 0600);
        }
        if (!preg_match('/^[a-f0-9]{64}$/D', $secret)) throw new RuntimeException('Invalid statistics secret');
        return $secret;
    } finally { flock($file, LOCK_UN); fclose($file); }
}
function localStatisticsToken(string $base): string {
    $payload = (time() + 86400) . '.' . bin2hex(random_bytes(16));
    return $payload . '.' . hash_hmac('sha256', $payload, localStatisticsSecret($base));
}
function verifyLocalStatisticsToken(string $base, mixed $token): bool {
    if (!is_string($token) || !preg_match('/^([0-9]{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/D', $token, $parts)) return false;
    return (int)$parts[1] >= time() && hash_equals(hash_hmac('sha256', $parts[1] . '.' . $parts[2], localStatisticsSecret($base)), $parts[3]);
}

// All callers hold this separate lock: replacing JSON never replaces the lock inode.
function transferStatistics(string $base, ?array $report = null): array {
    $lock = fopen($base . '/statistics.lock', 'c+');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Statistics lock failed');
    $temporary = null;
    try {
        $path = $base . '/statistics.json';
        $now = time();
        $data = is_file($path)
            ? json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR)
            : ['files' => 0, 'bytes' => 0, 'startedAt' => gmdate('c'), 'updatedAt' => null, 'rooms' => []];
        if (!is_array($data) || !is_int($data['files'] ?? null) || !is_int($data['bytes'] ?? null) || !is_array($data['rooms'] ?? null)) throw new RuntimeException('Invalid statistics');
        $changed = !is_file($path);
        // Existing file/byte totals are retained; historical connections were not recorded.
        if (!array_key_exists('uses', $data)) { $data['uses'] = 0; $data['usesStartedAt'] = gmdate('c'); $changed = true; }
        if (!is_int($data['uses']) || $data['uses'] < 0 || !is_string($data['usesStartedAt'] ?? null)) throw new RuntimeException('Invalid usage statistics');
        if ($report !== null) {
            foreach ($data['rooms'] as $key => $entry) {
                if ($entry['expires'] < $now) unset($data['rooms'][$key]);
            }
            $usage = ($report['kind'] ?? 'transfer') === 'usage';
            $room = $report['room']; $id = $report['id']; $size = $usage ? 0 : $report['size'];
            $bucket = $usage ? 'usages' : 'transfers';
            $entry = $data['rooms'][$room] ?? ['expires' => $report['expires'], 'transfers' => []];
            // Recovery keeps the same pairing; preserve its deduplication ledger
            // for the extended lifetime instead of counting it again later.
            if ($entry['expires'] < $report['expires']) {
                $entry['expires'] = $report['expires']; $data['rooms'][$room] = $entry; $changed = true;
            }
            $entry[$bucket] ??= [];
            if (array_key_exists($id, $entry[$bucket])) {
                if ($entry[$bucket][$id] !== $size) fail(409, 'Размер уже учтённой передачи отличается.');
            } else {
                if (count($entry[$bucket]) >= ($report['limit'] ?? 1000)) fail(429, 'Лимит статистики исчерпан.');
                if ($usage ? $data['uses'] >= 9007199254740991 : ($data['bytes'] > 9007199254740991 - $size || $data['files'] >= 9007199254740991)) throw new RuntimeException('Statistics overflow');
                $entry[$bucket][$id] = $size;
                $data['rooms'][$room] = $entry;
                if ($usage) $data['uses']++; else { $data['files']++; $data['bytes'] += $size; }
                $data['updatedAt'] = gmdate('c');
                $changed = true;
            }
        }
        if ($changed) {
            $temporary = tempnam($base, 'statistics-');
            if ($temporary === false) throw new RuntimeException('Statistics temporary file failed');
            $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
            if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) throw new RuntimeException('Statistics save failed');
        }
        return array_intersect_key($data, array_flip(['files', 'bytes', 'uses', 'usesStartedAt', 'startedAt', 'updatedAt']));
    } finally {
        if ($temporary && is_file($temporary)) unlink($temporary);
        flock($lock, LOCK_UN); fclose($lock);
    }
}
