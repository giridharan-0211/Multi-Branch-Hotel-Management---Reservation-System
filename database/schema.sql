CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(140) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(40) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    food_description TEXT NOT NULL DEFAULT '',
    service_description TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (name, city)
);

CREATE TABLE IF NOT EXISTS rooms (
    id BIGSERIAL PRIMARY KEY,
    branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    room_type VARCHAR(80) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    capacity SMALLINT NOT NULL CHECK (capacity > 0),
        inventory_count SMALLINT NOT NULL DEFAULT 20 CHECK (inventory_count > 0),
    price_per_night NUMERIC(10, 2) NOT NULL CHECK (price_per_night >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE branches ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS food_description TEXT NOT NULL DEFAULT '';
ALTER TABLE branches ADD COLUMN IF NOT EXISTS service_description TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS inventory_count SMALLINT NOT NULL DEFAULT 20 CHECK (inventory_count > 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_branch_name_unique ON rooms (branch_id, name);

CREATE TABLE IF NOT EXISTS bookings (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    guest_session_key CHAR(64),
    room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
        room_unit SMALLINT NOT NULL DEFAULT 1,
    guest_name VARCHAR(120) NOT NULL,
    guest_email VARCHAR(255) NOT NULL,
    guest_phone VARCHAR(30) NOT NULL,
    id_proof_type VARCHAR(30) NOT NULL,
    id_proof_last4 CHAR(4) NOT NULL,
    check_in DATE NOT NULL,
    check_out DATE NOT NULL,
    guests SMALLINT NOT NULL CHECK (guests > 0),
    total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
    payment_method VARCHAR(10) NOT NULL CHECK (payment_method IN ('card', 'upi')),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'demo_pending' CHECK (payment_status IN ('demo_pending', 'paid', 'failed')),
    services TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (check_out > check_in),
    CONSTRAINT bookings_room_unit_dates_excl EXCLUDE USING gist (
        room_id WITH =,
        room_unit WITH =,
        daterange(check_in, check_out, '[)') WITH &&
    ) WHERE (status = 'confirmed')
);

ALTER TABLE bookings ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_name VARCHAR(120);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_session_key CHAR(64);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_unit SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(30);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS id_proof_type VARCHAR(30);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS id_proof_last4 CHAR(4);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method VARCHAR(10);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'demo_pending';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS services TEXT[] NOT NULL DEFAULT '{}';
UPDATE bookings SET guest_name = COALESCE(guest_name, 'Existing guest'), guest_email = COALESCE(guest_email, 'not-provided@example.invalid'), guest_phone = COALESCE(guest_phone, '0000000000'), id_proof_type = COALESCE(id_proof_type, 'Other'), id_proof_last4 = COALESCE(id_proof_last4, '0000'), payment_method = COALESCE(payment_method, 'upi') WHERE guest_name IS NULL;
ALTER TABLE bookings ALTER COLUMN guest_name SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN guest_email SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN guest_phone SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN id_proof_type SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN id_proof_last4 SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN payment_method SET NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check CHECK (payment_method IN ('card', 'upi'));
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_id_daterange_excl;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_room_unit_dates_excl;
ALTER TABLE bookings ADD CONSTRAINT bookings_room_unit_dates_excl EXCLUDE USING gist (
    room_id WITH =,
    room_unit WITH =,
    daterange(check_in, check_out, '[)') WITH &&
) WHERE (status = 'confirmed');

CREATE TABLE IF NOT EXISTS activity_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    session_key CHAR(64),
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('search', 'booking')),
    branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL,
    room_id BIGINT REFERENCES rooms(id) ON DELETE SET NULL,
    check_in DATE,
    check_out DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewer_name VARCHAR(120) NOT NULL,
    target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('hotel', 'room')),
    branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((target_type = 'hotel' AND room_id IS NULL) OR (target_type = 'room' AND room_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_rooms_branch_active ON rooms (branch_id, active, price_per_night);
CREATE INDEX IF NOT EXISTS idx_bookings_user_created ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON bookings (room_id, check_in, check_out) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expiry ON auth_tokens (expires_at);
CREATE INDEX IF NOT EXISTS idx_activity_user_created ON activity_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_session_created ON activity_events (session_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_branch_created ON reviews (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_room_created ON reviews (room_id, created_at DESC) WHERE room_id IS NOT NULL;

UPDATE branches SET
    name = 'Satoryuzei Palace', city = 'Chennai',
    address = '12 Cathedral Road, Chennai', phone = '+91 44 4000 1001',
    description = 'A serene city address where contemporary Indian design meets warm, attentive hospitality.',
    image_url = 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=85',
    food_description = 'Saffron Table serves South Indian favourites, seasonal coastal seafood, and all-day comfort dishes. Breakfast is available each morning; meals are charged separately.',
    service_description = '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.'
WHERE city IN ('New York', 'Chennai') OR name = 'The Meridian House';

UPDATE branches SET
    name = 'Satoryuzei Palace', city = 'Bangalore',
    address = '18 Residency Road, Bengaluru', phone = '+91 80 4000 1002',
    description = 'A leafy urban retreat with crafted details, a welcoming lounge, and space to unwind between plans.',
    image_url = 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1400&q=85',
    food_description = 'The Courtyard Kitchen pairs regional Karnataka cooking with familiar Indian and international plates, made with seasonal ingredients.',
    service_description = '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.'
WHERE city IN ('Charleston', 'Bangalore') OR name = 'The Meridian Coast';

UPDATE branches SET
    name = 'Satoryuzei Palace', city = 'Kochi',
    address = '8 Marine Drive, Kochi', phone = '+91 484 4000 1003',
    description = 'A relaxed waterfront stay inspired by Kochi’s layered port-city culture and easy coastal rhythm.',
    image_url = 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1400&q=85',
    food_description = 'Harbour & Spice highlights Kerala flavours, appam and stew, fresh catch, and vegetarian dishes, alongside simple all-day dining.',
    service_description = '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.'
WHERE city IN ('Portland', 'Kochi') OR name = 'The Meridian Grove';

INSERT INTO branches (name, city, address, phone, description, image_url, food_description, service_description) VALUES
    ('Satoryuzei Palace', 'Chennai', '12 Cathedral Road, Chennai', '+91 44 4000 1001', 'A serene city address where contemporary Indian design meets warm, attentive hospitality.', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1400&q=85', 'Saffron Table serves South Indian favourites, seasonal coastal seafood, and all-day comfort dishes. Breakfast is available each morning; meals are charged separately.', '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.'),
    ('Satoryuzei Palace', 'Bangalore', '18 Residency Road, Bengaluru', '+91 80 4000 1002', 'A leafy urban retreat with crafted details, a welcoming lounge, and space to unwind between plans.', 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1400&q=85', 'The Courtyard Kitchen pairs regional Karnataka cooking with familiar Indian and international plates, made with seasonal ingredients.', '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.'),
    ('Satoryuzei Palace', 'Kochi', '8 Marine Drive, Kochi', '+91 484 4000 1003', 'A relaxed waterfront stay inspired by Kochi’s layered port-city culture and easy coastal rhythm.', 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1400&q=85', 'Harbour & Spice highlights Kerala flavours, appam and stew, fresh catch, and vegetarian dishes, alongside simple all-day dining.', '24-hour front desk, room service from 7:00 AM to 10:30 PM, daily housekeeping, and concierge assistance.')
ON CONFLICT (name, city) DO UPDATE SET
    address = EXCLUDED.address, phone = EXCLUDED.phone, description = EXCLUDED.description,
    image_url = EXCLUDED.image_url, food_description = EXCLUDED.food_description,
    service_description = EXCLUDED.service_description, active = TRUE;

UPDATE rooms SET name = 'Standard AC', room_type = 'Standard AC', description = 'A comfortable air-conditioned room with a restful bed, fresh linens, and an ensuite bathroom.', capacity = 2, price_per_night = 5999, image_url = 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=900&q=85' WHERE name = 'Garden King';
UPDATE rooms SET name = 'Standard Non AC', room_type = 'Standard Non AC', description = 'A bright, naturally ventilated room with thoughtful essentials and an ensuite bathroom.', capacity = 2, price_per_night = 4999, image_url = 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=85' WHERE name = 'Corner Studio';
UPDATE rooms SET name = 'Deluxe AC', room_type = 'Deluxe AC', description = 'A spacious air-conditioned room with upgraded comforts and a generous sitting corner.', capacity = 3, price_per_night = 7999, image_url = 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=85' WHERE name = 'Family Loft';

INSERT INTO rooms (branch_id, name, room_type, description, capacity, price_per_night, image_url)
SELECT b.id, room.name, room.room_type, room.description, room.capacity, room.price, room.image_url
FROM branches b
CROSS JOIN (VALUES
    ('Standard AC', 'Standard AC', 'A comfortable air-conditioned room with a restful bed, fresh linens, and an ensuite bathroom.', 2, 5999.00::NUMERIC, 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=900&q=85'),
    ('Standard Non AC', 'Standard Non AC', 'A bright, naturally ventilated room with thoughtful essentials and an ensuite bathroom.', 2, 4999.00::NUMERIC, 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=900&q=85'),
    ('Deluxe AC', 'Deluxe AC', 'A spacious air-conditioned room with upgraded comforts and a generous sitting corner.', 3, 7999.00::NUMERIC, 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=900&q=85'),
    ('Deluxe Non AC', 'Deluxe Non AC', 'An airy deluxe room with extra space, natural ventilation, and a relaxed lounge nook.', 3, 6999.00::NUMERIC, 'https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=900&q=85')
) AS room(name, room_type, description, capacity, price, image_url)
WHERE b.city IN ('Chennai', 'Bangalore', 'Kochi')
ON CONFLICT (branch_id, name) DO UPDATE SET
    room_type = EXCLUDED.room_type, description = EXCLUDED.description,
    capacity = EXCLUDED.capacity, price_per_night = EXCLUDED.price_per_night,
    image_url = EXCLUDED.image_url, active = TRUE;

UPDATE bookings b SET total_price = r.price_per_night * (b.check_out - b.check_in)
FROM rooms r
WHERE b.room_id = r.id
    AND b.total_price = (CASE r.name
            WHEN 'Standard AC' THEN 189
            WHEN 'Standard Non AC' THEN 249
            WHEN 'Deluxe AC' THEN 319
            ELSE NULL
    END) * (b.check_out - b.check_in);