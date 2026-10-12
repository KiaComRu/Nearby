<?php
declare(strict_types=1);
umask(0077);
ini_set('display_errors', '0');
// Short HTTPS requests only. Files never pass through this signaling API.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function reply(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(int $status, string $message): never { reply($status, ['error' => $message]); }
function hexToken(int $bytes = 32): string { return bin2hex(random_bytes($bytes)); }
function nameValue(mixed $value): string {
    if (!is_string($value) || !preg_match('//u', $value)) return 'Устройство';
    $clean = preg_replace('/[\x00-\x1f\x7f]/u', '', $value);
    preg_match('/^.{0,40}/us', $clean, $match);
    return $match[0] ?: 'Устройство';
}
function writeState($handle, array $state): void {
    rewind($handle); ftruncate($handle, 0);
    if (fwrite($handle, json_encode($state, JSON_THROW_ON_ERROR)) === false) throw new RuntimeException('State write failed');
    fflush($handle);
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Используйте POST.');
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        $origin = parse_url($_SERVER['HTTP_ORIGIN']);
        $host = $_SERVER['HTTP_HOST'] ?? '';
        $originHost = ($origin['host'] ?? '') . (isset($origin['port']) ? ':' . $origin['port'] : '');
        if ($originHost !== $host || !in_array($origin['scheme'] ?? '', ['http', 'https'], true)) fail(403, 'Другой источник запроса.');
    }
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') fail(415, 'Нужен JSON.');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 49152) fail(413, 'Слишком большой запрос.');
    $raw = file_get_contents('php://input', false, null, 0, 49153);
    if (strlen($raw) > 49152) fail(413, 'Слишком большой запрос.');
    try { $input = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
    catch (JsonException $e) { fail(400, 'Некорректный JSON.'); }
    if (!is_array($input)) fail(400, 'Некорректный запрос.');
    $action = $input['action'] ?? '';
    $now = time();
    $config = is_file(__DIR__ . '/config.private.php') ? require __DIR__ . '/config.private.php' : [];
    $base = getenv('NEARBY_WEB_STATE_DIR') ?: ($config['stateDirectory'] ?? sys_get_temp_dir() . '/nearby-web-' . substr(hash('sha256', __DIR__), 0, 16));
    if (!is_dir($base) && !mkdir($base, 0700, true) && !is_dir($base)) throw new RuntimeException('State directory unavailable');
    $base = realpath($base);
    if (!$base || str_starts_with($base . '/', realpath(__DIR__) . '/')) throw new RuntimeException('Unsafe state path');

    // Per-address budget and bounded state, with lock shared by PHP workers.
    $budgetKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $budget = fopen($base . '/budget-' . $budgetKey . '.json', 'c+');
    if (!$budget || !flock($budget, LOCK_EX)) throw new RuntimeException('Rate limit lock failed');
    $rate = json_decode(stream_get_contents($budget), true) ?: ['window' => $now, 'requests' => 0, 'creates' => 0];
    if ($now - $rate['window'] >= 60) $rate = ['window' => $now, 'requests' => 0, 'creates' => 0];
    $rate['requests']++;
    if ($action === 'create') $rate['creates']++;
    writeState($budget, $rate); flock($budget, LOCK_UN); fclose($budget);
    if ($rate['requests'] > 240 || $rate['creates'] > 10) fail(429, 'Слишком много запросов. Подождите минуту.');

    if ($action === 'create') {
        $global = fopen($base . '/create.lock', 'c+');
        if (!$global || !flock($global, LOCK_EX)) throw new RuntimeException('Creation lock failed');
        $active = 0;
        foreach (glob($base . '/room-*.json') ?: [] as $path) {
            $f = fopen($path, 'r+');
            if (!$f) continue;
            if (flock($f, LOCK_EX | LOCK_NB)) {
                $old = json_decode(stream_get_contents($f), true);
                if (!$old || ($old['expires'] ?? 0) < $now) unlink($path); else $active++;
                flock($f, LOCK_UN);
            } else $active++;
            fclose($f);
        }
        foreach (glob($base . '/budget-*.json') ?: [] as $path) {
            if (filemtime($path) < $now - 3600) @unlink($path);
        }
        if ($active >= 200) { flock($global, LOCK_UN); fclose($global); fail(503, 'Сервис занят. Попробуйте позже.'); }
        $room = hexToken(16); $host = hexToken(); $invite = hexToken();
        $state = ['host' => hash('sha256', $host), 'invite' => hash('sha256', $invite), 'guest' => null,
            'hostName' => nameValue($input['name'] ?? ''), 'guestName' => null, 'approved' => false,
            'expires' => $now + 900, 'created' => $now, 'seq' => 0, 'messages' => [], 'closed' => false];
        $f = fopen($base . '/room-' . $room . '.json', 'x+');
        if (!$f) throw new RuntimeException('Room creation failed');
        chmod($base . '/room-' . $room . '.json', 0600); writeState($f, $state); fclose($f);
        flock($global, LOCK_UN); fclose($global);
        reply(201, ['room' => $room, 'token' => $host, 'invite' => $invite, 'expires' => $state['expires']]);
    }
    $room = $input['room'] ?? '';
    if (!is_string($room) || !preg_match('/^[a-f0-9]{32}$/D', $room)) fail(400, 'Некорректная комната.');
    $path = $base . '/room-' . $room . '.json';
    $f = @fopen($path, 'r+');
    if (!$f) fail(404, 'Приглашение не найдено или истекло.');
    if (!flock($f, LOCK_EX)) throw new RuntimeException('Room lock failed');
    $state = json_decode(stream_get_contents($f), true, 32, JSON_THROW_ON_ERROR);
    if ($state['expires'] < $now || $state['closed']) { flock($f, LOCK_UN); fclose($f); fail(410, 'Комната закрыта или время подключения истекло.'); }
    $token = $input['token'] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) fail(403, 'Недействительный ключ.');
    $digest = hash('sha256', $token);
    if ($action === 'join') {
        if (!hash_equals($state['invite'], $digest)) fail(403, 'Недействительное приглашение.');
        if ($state['guest'] !== null) fail(409, 'Приглашение уже использовано. Создайте новое.');
        $guest = hexToken(); $state['guest'] = hash('sha256', $guest);
        $state['guestName'] = nameValue($input['name'] ?? '');
        writeState($f, $state); flock($f, LOCK_UN); fclose($f);
        reply(200, ['token' => $guest, 'hostName' => $state['hostName'], 'expires' => $state['expires']]);
    }
    $role = hash_equals($state['host'], $digest) ? 'host' : (($state['guest'] && hash_equals($state['guest'], $digest)) ? 'guest' : null);
    if (!$role) fail(403, 'Недействительный ключ.');
    if ($action === 'approve') {
        if ($role !== 'host' || !$state['guest']) fail(403, 'Подтверждение недоступно.');
        $state['approved'] = true;
    } elseif ($action === 'close') {
        $state['closed'] = true; $state['messages'] = [];
    } elseif ($action === 'signal') {
        if (!$state['approved']) fail(403, 'Сначала подтвердите устройство.');
        $message = $input['message'] ?? null;
        if (!is_array($message) || !in_array($message['type'] ?? '', ['offer', 'answer', 'candidate'], true)) fail(400, 'Некорректное сообщение.');
        if (in_array($message['type'], ['offer', 'answer'], true)) {
            if (!is_string($message['sdp'] ?? null) || strlen($message['sdp']) > 32768) fail(400, 'Некорректное описание соединения.');
            if (($message['type'] === 'offer' && $role !== 'host') || ($message['type'] === 'answer' && $role !== 'guest')) fail(403, 'Неверная роль.');
        } else {
            if (!is_array($message['candidate'] ?? null) || strlen(json_encode($message)) > 4096) fail(400, 'Некорректный адрес соединения.');
        }
        if (count($state['messages']) >= 128) fail(429, 'Слишком много сообщений соединения.');
        $state['messages'][] = ['id' => ++$state['seq'], 'from' => $role, 'body' => $message];
    } elseif ($action !== 'poll') fail(400, 'Неизвестная операция.');
    $after = $input['after'] ?? 0;
    if (!is_int($after) || $after < 0) fail(400, 'Некорректный курсор.');
    $messages = array_values(array_filter($state['messages'], fn($m) => $m['from'] !== $role && $m['id'] > $after));
    // Absolute lifetime; no infinite rooms and no uploaded user files.
    writeState($f, $state); flock($f, LOCK_UN); fclose($f);
    reply(200, ['approved' => $state['approved'], 'guestName' => $state['guestName'], 'hostName' => $state['hostName'], 'messages' => $messages, 'cursor' => $state['seq'], 'expires' => $state['expires']]);
} catch (Throwable $e) {
    error_log('Nearby signaling: ' . get_class($e));
    fail(500, 'Не удалось обработать запрос. Попробуйте позже.');
}
