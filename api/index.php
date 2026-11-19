<?php
declare(strict_types=1);

require_once __DIR__ . '/database.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function body(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($data)) {
        respond(['error' => 'Request body must be valid JSON.'], 400);
    }
    return $data;
}

function requireFields(array $data, array $fields): void
{
    foreach ($fields as $field) {
        if (!isset($data[$field]) || trim((string)$data[$field]) === '') {
            respond(['error' => "The {$field} field is required."], 422);
        }
    }
}

function currentUser(bool $required = true): ?array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        if ($required) {
            respond(['error' => 'Sign in to continue.'], 401);
        }
        return null;
    }

    $query = db()->prepare('SELECT u.id, u.name, u.email, u.role FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = :hash AND t.expires_at > NOW()');
    $query->execute(['hash' => hash('sha256', $matches[1])]);
    $user = $query->fetch();
    if (!$user && $required) {
        respond(['error' => 'Your session has expired. Please sign in again.'], 401);
    }
    return $user ?: null;
}

function requireAdmin(): array
{
    $user = currentUser();
    if ($user['role'] !== 'admin') {
        respond(['error' => 'Administrator access is required.'], 403);
    }
    return $user;
}

function routePath(): array
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $marker = '/api.php';
    $position = strpos($path, $marker);
    $path = $position === false ? $path : substr($path, $position + strlen($marker));
    return array_values(array_filter(explode('/', trim($path, '/')), 'strlen'));
}

function createToken(int $userId): string
{
    $token = bin2hex(random_bytes(32));
    $statement = db()->prepare("INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (:user_id, :hash, NOW() + INTERVAL '30 days')");
    $statement->execute(['user_id' => $userId, 'hash' => hash('sha256', $token)]);
    return $token;
}

function publicUser(array $user): array
{
    unset($user['password_hash']);
    return $user;
}

function fetchBranches(): array
{
    return db()->query(
        'SELECT b.id, b.name, b.city, b.address, b.phone, b.description, b.image_url, b.food_description, b.service_description,
            COALESCE(SUM(r.inventory_count) FILTER (WHERE r.active = TRUE), 0) AS room_count,
            MIN(r.price_per_night) FILTER (WHERE r.active = TRUE) AS starting_price
         FROM branches b LEFT JOIN rooms r ON r.branch_id = b.id
         WHERE b.active = TRUE GROUP BY b.id
         ORDER BY CASE b.city WHEN \'Chennai\' THEN 1 WHEN \'Bangalore\' THEN 2 WHEN \'Kochi\' THEN 3 ELSE 4 END, b.name'
    )->fetchAll();
}

try {
    $segments = routePath();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $resource = $segments[0] ?? '';
    $id = isset($segments[1]) && ctype_digit($segments[1]) ? (int)$segments[1] : null;
    $action = $segments[2] ?? '';

    if ($resource === 'health' && $method === 'GET') {
        db()->query('SELECT 1');
        respond(['status' => 'ok', 'database' => 'connected']);
    }

    if ($resource === 'auth' && $method === 'POST' && ($segments[1] ?? '') === 'register') {
        $data = body();
        requireFields($data, ['name', 'email', 'password']);
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL) || strlen((string)$data['password']) < 8) {
            respond(['error' => 'Use a valid email and a password of at least 8 characters.'], 422);
        }
        $statement = db()->prepare('INSERT INTO users (name, email, password_hash) VALUES (:name, LOWER(:email), :password) RETURNING id, name, email, role');
        try {
            $statement->execute([
                'name' => trim($data['name']),
                'email' => trim($data['email']),
                'password' => password_hash($data['password'], PASSWORD_DEFAULT),
            ]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23505') {
                respond(['error' => 'An account with that email already exists.'], 409);
            }
            throw $error;
        }
        $user = $statement->fetch();
        respond(['user' => $user, 'token' => createToken((int)$user['id'])], 201);
    }

    if ($resource === 'auth' && $method === 'POST' && ($segments[1] ?? '') === 'login') {
        $data = body();
        requireFields($data, ['email', 'password']);
        $statement = db()->prepare('SELECT id, name, email, role, password_hash FROM users WHERE email = LOWER(:email)');
        $statement->execute(['email' => trim($data['email'])]);
        $user = $statement->fetch();
        if (!$user || !password_verify($data['password'], $user['password_hash'])) {
            respond(['error' => 'Email or password is incorrect.'], 401);
        }
        $token = createToken((int)$user['id']);
        respond(['user' => publicUser($user), 'token' => $token]);
    }

    if ($resource === 'auth' && $method === 'GET' && ($segments[1] ?? '') === 'me') {
        respond(['user' => currentUser()]);
    }

    if ($resource === 'auth' && $method === 'POST' && ($segments[1] ?? '') === 'logout') {
        currentUser();
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        preg_match('/^Bearer\s+(.+)$/i', $header, $matches);
        $statement = db()->prepare('DELETE FROM auth_tokens WHERE token_hash = :hash');
        $statement->execute(['hash' => hash('sha256', $matches[1])]);
        respond(['message' => 'Signed out.']);
    }

    if ($resource === 'branches' && $method === 'GET' && $id === null) {
        respond(['branches' => fetchBranches()]);
    }

    if ($resource === 'branches' && $method === 'GET' && $id !== null && ($action === 'rooms' || $action === '')) {
        if (isset($_GET['check_in']) !== isset($_GET['check_out'])) {
            respond(['error' => 'Both check-in and check-out dates are required for availability.'], 422);
        }
        if (isset($_GET['check_in'], $_GET['check_out'])) {
            $start = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$_GET['check_in']);
            $end = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$_GET['check_out']);
            if (!$start || !$end || $start->format('Y-m-d') !== $_GET['check_in'] || $end->format('Y-m-d') !== $_GET['check_out'] || $end <= $start) {
                respond(['error' => 'Choose valid check-in and check-out dates.'], 422);
            }
        }
        $availability = 'r.inventory_count';
        if (isset($_GET['check_in'], $_GET['check_out'])) {
            $availability = "GREATEST(0, r.inventory_count - (SELECT COUNT(*) FROM bookings bk WHERE bk.room_id = r.id AND bk.status = 'confirmed' AND bk.check_in < :check_out AND bk.check_out > :check_in))";
        }
        $sql = "SELECT r.id, r.branch_id, r.name, r.room_type, r.description, r.capacity, r.inventory_count, {$availability} AS available_rooms, r.price_per_night, r.image_url
                FROM rooms r WHERE r.branch_id = :branch_id AND r.active = TRUE";
        $params = ['branch_id' => $id];
        if (isset($_GET['guests'])) {
            $guests = filter_var($_GET['guests'], FILTER_VALIDATE_INT);
            if (!$guests || $guests < 1) {
                respond(['error' => 'Guest count must be at least one.'], 422);
            }
            $sql .= ' AND r.capacity >= :guests';
            $params['guests'] = $guests;
        }
        if (!empty($_GET['check_in']) && !empty($_GET['check_out'])) {
            $params['check_in'] = $_GET['check_in'];
            $params['check_out'] = $_GET['check_out'];
        }
        $sql .= ' ORDER BY r.price_per_night';
        $statement = db()->prepare($sql);
        $statement->execute($params);
        respond(['rooms' => $statement->fetchAll()]);
    }

    if ($resource === 'admin' && $method === 'GET' && ($segments[1] ?? '') === 'overview') {
        requireAdmin();
        $summary = db()->query("SELECT
            (SELECT COUNT(*) FROM branches WHERE active = TRUE) AS branches,
            (SELECT COALESCE(SUM(inventory_count), 0) FROM rooms WHERE active = TRUE) AS rooms,
            (SELECT COUNT(*) FROM bookings WHERE status = 'confirmed') AS active_bookings,
            (SELECT COALESCE(SUM(total_price), 0) FROM bookings WHERE status = 'confirmed') AS booked_revenue")->fetch();
        respond(['summary' => $summary, 'branches' => fetchBranches()]);
    }

    if ($resource === 'bookings' && $method === 'GET') {
        $user = currentUser();
        $sql = 'SELECT bk.id, bk.room_unit, bk.check_in, bk.check_out, bk.guests, bk.status, bk.total_price, bk.created_at,
                       r.name AS room_name, r.room_type, b.name AS branch_name, b.city AS branch_city
                FROM bookings bk JOIN rooms r ON r.id = bk.room_id JOIN branches b ON b.id = r.branch_id';
        if (($user['role'] ?? '') === 'admin' && ($_GET['all'] ?? '') === 'true') {
            $sql .= ' ORDER BY bk.created_at DESC';
            $statement = db()->query($sql);
        } else {
            $sql .= ' WHERE bk.user_id = :user_id ORDER BY bk.created_at DESC';
            $statement = db()->prepare($sql);
            $statement->execute(['user_id' => $user['id']]);
        }
        respond(['bookings' => $statement->fetchAll()]);
    }

    if ($resource === 'bookings' && $method === 'POST') {
        $user = currentUser();
        $data = body();
        requireFields($data, ['room_id', 'check_in', 'check_out', 'guests', 'guest_name', 'guest_phone', 'id_proof_type', 'id_proof_last4', 'payment_method']);
        $checkIn = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$data['check_in']);
        $checkOut = DateTimeImmutable::createFromFormat('!Y-m-d', (string)$data['check_out']);
        $guests = filter_var($data['guests'], FILTER_VALIDATE_INT);
        if (!$checkIn || !$checkOut || $checkIn->format('Y-m-d') !== $data['check_in'] || $checkOut->format('Y-m-d') !== $data['check_out'] || $checkIn < new DateTimeImmutable('today') || $checkOut <= $checkIn || !$guests || $guests < 1) {
            respond(['error' => 'Choose valid future dates and at least one guest.'], 422);
        }
        $phone = (string)$data['guest_phone'];
        if (trim((string)$data['guest_name']) === '' || strlen(trim((string)$data['guest_name'])) > 120 || !preg_match('/^[0-9]{10}$/', $phone)) {
            respond(['error' => 'Enter a name and a valid 10-digit phone number.'], 422);
        }
        if (!in_array($data['id_proof_type'], ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'Other'], true) || !preg_match('/^[0-9]{4}$/', (string)$data['id_proof_last4'])) {
            respond(['error' => 'Choose an ID proof type and enter its last four digits only.'], 422);
        }
        if (!in_array($data['payment_method'], ['card', 'upi'], true)) {
            respond(['error' => 'Choose Card or UPI as your payment method.'], 422);
        }

        $pdo = db();
        $pdo->beginTransaction();
        try {
            $roomQuery = $pdo->prepare('SELECT id, capacity, inventory_count, price_per_night FROM rooms WHERE id = :id AND active = TRUE FOR UPDATE');
            $roomQuery->execute(['id' => (int)$data['room_id']]);
            $room = $roomQuery->fetch();
            if (!$room || $guests > (int)$room['capacity']) {
                $pdo->rollBack();
                respond(['error' => 'That room is unavailable for the selected guest count.'], 409);
            }
            $unitQuery = $pdo->prepare(
                "SELECT candidate.unit_number
                 FROM generate_series(1, CAST(:inventory_count AS INTEGER)) AS candidate(unit_number)
                 WHERE NOT EXISTS (
                    SELECT 1 FROM bookings bk
                    WHERE bk.room_id = :room_id AND bk.room_unit = candidate.unit_number AND bk.status = 'confirmed'
                      AND bk.check_in < :check_out AND bk.check_out > :check_in
                 )
                 ORDER BY candidate.unit_number LIMIT 1"
            );
            $unitQuery->execute([
                'inventory_count' => $room['inventory_count'], 'room_id' => $room['id'],
                'check_in' => $data['check_in'], 'check_out' => $data['check_out'],
            ]);
            $roomUnit = $unitQuery->fetchColumn();
            if ($roomUnit === false) {
                $pdo->rollBack();
                respond(['error' => 'All rooms of this type are booked for those dates. Please choose other dates or another room type.'], 409);
            }
            $nights = (int)$checkIn->diff($checkOut)->days;
            $insert = $pdo->prepare("INSERT INTO bookings (user_id, room_id, room_unit, guest_name, guest_email, guest_phone, id_proof_type, id_proof_last4, check_in, check_out, guests, total_price, payment_method, payment_status, status) VALUES (:user_id, :room_id, :room_unit, :guest_name, :guest_email, :guest_phone, :id_proof_type, :id_proof_last4, :check_in, :check_out, :guests, :total, :payment_method, 'demo_pending', 'confirmed') RETURNING id, room_unit, check_in, check_out, guests, total_price, payment_method, payment_status, status");
            $insert->execute([
                'user_id' => $user['id'], 'room_id' => $room['id'], 'room_unit' => $roomUnit,
                'guest_name' => trim($data['guest_name']), 'guest_email' => $user['email'],
                'guest_phone' => $phone, 'id_proof_type' => $data['id_proof_type'],
                'id_proof_last4' => $data['id_proof_last4'], 'payment_method' => $data['payment_method'],
                'check_in' => $data['check_in'],
                'check_out' => $data['check_out'], 'guests' => $guests,
                'total' => $nights * (float)$room['price_per_night'],
            ]);
            $bookingId = (int)$insert->fetchColumn();
            $receipt = $pdo->prepare(
                'SELECT bk.id, bk.room_unit, bk.guest_name, bk.guest_email, bk.guest_phone, bk.id_proof_type, bk.id_proof_last4,
                        bk.check_in, bk.check_out, bk.guests, bk.total_price, bk.payment_method, bk.payment_status, bk.status,
                        r.name AS room_name, r.room_type, b.name AS branch_name, b.city AS branch_city, b.address AS branch_address
                 FROM bookings bk JOIN rooms r ON r.id = bk.room_id JOIN branches b ON b.id = r.branch_id
                 WHERE bk.id = :id'
            );
            $receipt->execute(['id' => $bookingId]);
            $booking = $receipt->fetch();
            $pdo->commit();
            respond(['booking' => $booking], 201);
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
    }

    if ($resource === 'bookings' && $method === 'PATCH' && $id !== null && $action === 'cancel') {
        $user = currentUser();
        $statement = db()->prepare("UPDATE bookings SET status = 'cancelled' WHERE id = :id AND status = 'confirmed' AND (user_id = :user_id OR :is_admin = TRUE) RETURNING id, status");
        $statement->execute(['id' => $id, 'user_id' => $user['id'], 'is_admin' => $user['role'] === 'admin']);
        $booking = $statement->fetch();
        if (!$booking) {
            respond(['error' => 'Booking not found or it can no longer be cancelled.'], 404);
        }
        respond(['booking' => $booking]);
    }

    if ($resource === 'admin') {
        requireAdmin();
        if ($method === 'POST' && ($segments[1] ?? '') === 'branches') {
            $data = body();
            requireFields($data, ['name', 'city', 'address']);
            $statement = db()->prepare('INSERT INTO branches (name, city, address, phone, description) VALUES (:name, :city, :address, :phone, :description) RETURNING id, name, city, address, phone, description');
            $statement->execute([
                'name' => trim($data['name']), 'city' => trim($data['city']), 'address' => trim($data['address']),
                'phone' => trim((string)($data['phone'] ?? '')), 'description' => trim((string)($data['description'] ?? '')),
            ]);
            respond(['branch' => $statement->fetch()], 201);
        }
        if ($method === 'POST' && ($segments[1] ?? '') === 'rooms') {
            $data = body();
            requireFields($data, ['branch_id', 'name', 'room_type', 'capacity', 'price_per_night']);
            if ((int)$data['capacity'] < 1 || (float)$data['price_per_night'] < 0) {
                respond(['error' => 'Capacity must be positive and price cannot be negative.'], 422);
            }
            $statement = db()->prepare('INSERT INTO rooms (branch_id, name, room_type, description, capacity, price_per_night, image_url) VALUES (:branch_id, :name, :type, :description, :capacity, :price, :image) RETURNING id, branch_id, name, room_type, capacity, price_per_night');
            $statement->execute([
                'branch_id' => (int)$data['branch_id'], 'name' => trim($data['name']), 'type' => trim($data['room_type']),
                'description' => trim((string)($data['description'] ?? '')), 'capacity' => (int)$data['capacity'],
                'price' => (float)$data['price_per_night'], 'image' => trim((string)($data['image_url'] ?? '')),
            ]);
            respond(['room' => $statement->fetch()], 201);
        }
    }

    respond(['error' => 'Endpoint not found.'], 404);
} catch (Throwable $error) {
    error_log((string)$error);
    if ($error instanceof PDOException && $error->getCode() === '23P01') {
        respond(['error' => 'That room has already been booked for those dates. Please choose another.'], 409);
    }
    respond(['error' => 'A server error occurred. Check the PHP error log for details.'], 500);
}
