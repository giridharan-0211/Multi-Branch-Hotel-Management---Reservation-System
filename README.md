# Satoryuzei Palace

A multi-branch hotel reservation application for Chennai, Bangalore, and Kochi, with a PHP JSON REST API, PostgreSQL database, and responsive Bootstrap frontend. Each room category has 20 physical units by default. Room rates are stored and displayed in Indian rupees, starting at ₹4,999 per night.

## Live Demo
[Live Demo](https://multi-branch-hotel-management.onrender.com/)   

## Requirements

- PHP 8.1 or newer with `pdo_pgsql` enabled
- PostgreSQL 13 or newer
- A browser with JavaScript enabled

Bootstrap 5 and the illustrative hotel/room photographs are loaded from external CDNs, so the browser needs internet access. Replace the sample Unsplash image URLs with licensed property photos before public launch. The application code itself has no Composer or npm dependencies.

## Run locally

1. Create a PostgreSQL database:

   ```powershell
   createdb -U postgres hotel_reservations
   ```

   Or create a database named `hotel_reservations` using pgAdmin.

2. Load the schema and sample hotel branches/rooms:

   ```powershell
   psql -U postgres -d hotel_reservations -f database/schema.sql
   ```

   The schema enables PostgreSQL's `btree_gist` extension for its database-level reservation overlap constraint. The PostgreSQL role running this command must be allowed to create that extension.

   If you already created the database using an earlier version of this project, run this command again. The updated schema renames the sample branches to Satoryuzei Palace in Chennai, Bangalore, and Kochi; updates the sample rooms and INR prices; and preserves existing booking records while converting only known demo-price totals.

   Re-running the schema is safe for the sample locations and rooms. It may add newer optional database columns; this application version keeps them in place so existing booking data is not dropped.

3. Copy `.env.example` to `.env` and set your PostgreSQL username and password. On PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Start PHP's development server from the project root:

   ```powershell
   php -S 127.0.0.1:8000 -t public
   ```

5. Open `http://127.0.0.1:8000`. Check `http://127.0.0.1:8000/api.php/health` to verify the API can connect to PostgreSQL.

## First account and administrator access

Create an account from the website to reserve rooms. To grant a local account administrator access, run this SQL after registration, replacing the email:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

Sign out and back in after changing the role so the new role is reflected in the session. Do not use this promotion query as an unauthenticated production workflow; protect administrator provisioning operationally.

## REST API

All API responses are JSON. Protected endpoints accept `Authorization: Bearer <token>`. Tokens are randomly generated, stored only as SHA-256 hashes, and expire after 30 days. The browser stores its active token in local storage.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api.php/health` | Public | API and database health |
| GET | `/api.php/branches` | Public | Active branches and room starting prices |
| GET | `/api.php/branches/{id}/rooms?check_in=YYYY-MM-DD&check_out=YYYY-MM-DD` | Public | Active rooms, optionally filtered for availability |
| POST | `/api.php/auth/register` | Public | Create customer account; returns user and token |
| POST | `/api.php/auth/login` | Public | Sign in; returns user and token |
| GET | `/api.php/auth/me` | Signed in | Current account |
| POST | `/api.php/auth/logout` | Signed in | Revoke current token |
| GET | `/api.php/bookings` | Signed in | Current user's bookings |
| GET | `/api.php/bookings?all=true` | Admin | All bookings |
| POST | `/api.php/bookings` | Signed in | Reserve a room |
| PATCH | `/api.php/bookings/{id}/cancel` | Owner or admin | Cancel a confirmed booking |
| GET | `/api.php/admin/overview` | Admin | Property, room, booking, and revenue summary |
| POST | `/api.php/admin/branches` | Admin | Add a property |
| POST | `/api.php/admin/rooms` | Admin | Add a room |

Example reservation body:

```json
{
  "room_id": 1,
  "check_in": "2027-05-10",
  "check_out": "2027-05-12",
  "guests": 2
}
```

The API validates dates and guest capacity, uses prepared statements, calculates totals on the server, and checks for date overlap inside a transaction. PostgreSQL's exclusion constraint independently rejects overlapping confirmed bookings for the same room.

## Included workflows

- Browse Satoryuzei Palace in Chennai, Bangalore, and Kochi, including hotel photos, dining and room-service descriptions, and photos of Standard AC, Standard Non AC, Deluxe AC, and Deluxe Non AC rooms.
- Search room availability by destination, stay dates, and guest count; displayed room prices start at ₹4,999 per night.
- Each category defaults to 20 numbered units. Availability is counted for the selected stay dates, and a booking reserves one free unit so up to 20 guests can book that room type for overlapping dates.
- Register, sign in, book, and cancel reservations.
- Admin overview with booking/revenue totals and forms to add properties and rooms.
- Seed SQL can be run again without duplicating the sample properties or rooms.

## Notes before production

Use HTTPS, configure a production web server with only `public/` exposed, set strong database credentials, and add rate limiting, email verification, payment handling, and a production-grade session/token rotation policy before accepting real customer data or payments. The built-in PHP server is for local development only.
