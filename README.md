# Fable Studio V2

A full-stack Fable Studio order platform for Minecraft, Discord, website, plugin and custom development.

## Included
- Real registration/login with bcrypt password hashing
- HTTP-only signed session cookie + JWT
- SQLite database for users, services, orders and tracking events
- Customer dashboard and order tracking timeline
- Admin dashboard with stats, users, orders and service pricing controls
- Order status updates and admin notes
- Server-side Discord webhook order notifications
- Responsive premium Fable Studio UI
- Supplied Fable logo included at `public/assets/fable-logo.jpg`

## Run locally
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set strong `JWT_SECRET`, `COOKIE_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Optionally set `DISCORD_WEBHOOK_URL`.
5. Run `npm install`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

The first server start creates the admin account from the ADMIN_* variables.

## Production notes
Use HTTPS, strong secrets, persistent disk, regular database backups, rate limiting, email verification/password reset, CSRF protection appropriate to your deployment, and PostgreSQL if the project grows significantly.
