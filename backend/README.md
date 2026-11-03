# Moments Backend

Shared backend for Ruth & Elvis's private wedding photo wall, guest messages, and RSVP tracking.

## Run Locally

Requires Node.js 20 or later.

```powershell
cd backend
npm install
npm start
```

Environment variables are loaded automatically from `.env`:
- `PORT` (default: `3000`)
- `EVENT_CODE` (default: `ruthandelvis2026`)
- `ADMIN_CODE` (default: `moments`)
- `SUPABASE_URL` (optional: connect to Supabase PostgreSQL & Storage)
- `SUPABASE_SERVICE_ROLE_KEY` (optional: Supabase service role key)

When Supabase credentials are set, data is stored in PostgreSQL and photos in Supabase Storage. Otherwise, it runs seamlessly in local mode with `moments.db`. Static frontend pages are served directly from `../web`.

## Rules Enforced on the Server

- Each guest can upload up to 10 photos and post up to 2 sticky notes (enforced within an atomic SQLite transaction).
- Messages are 1 to 150 characters, with optional author attribution (up to 50 characters).
- Photos must be JPG, PNG, WebP or HEIC, and up to 5 MB.
- Guests can delete their own uploaded photos to free slots.
- Uploads can be paused or closed after a set deadline in admin settings.
- Moderation approval queue: new items can require organizer approval before appearing on the public wall and venue display.
- RSVP tracking: records guest names, attendance (yes/no), headcount, and dietary notes.
- Timing-safe authentication comparisons for guest tokens and admin passcodes.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /api/quote | Public | Random wedding quote |
| POST | /api/rsvp | Public | Submit an RSVP |
| POST | /api/join | Public | Join event with guest code, returns bearer token |
| GET | /api/me | Guest | Check remaining photos and messages |
| GET | /api/photos | Public | Approved photos with like counts and signatures |
| POST | /api/photos | Guest | Upload a photo (multipart `photo`, optional `author`) |
| DELETE | /api/photos/:id | Guest | Remove own photo |
| POST | /api/photos/:id/like | Guest | Toggle like on a photo |
| GET | /api/messages | Public | Approved sticky notes |
| POST | /api/messages | Guest | Post a note `{ "text": "...", "author": "..." }` |
| GET | /api/display/:token/photos | Display | Approved photos only for slideshow |
| GET | /api/display/:token/wall | Display | Approved photos and messages for venue wall |
| POST | /api/admin/login | Admin Code | Returns 8-hour admin session token |
| GET | /api/admin/summary | Admin | Overview counts (photos, messages, RSVPs, pending) |
| GET / PATCH / DELETE | /api/admin/photos[/:id] | Admin | List, moderate (approve/hide), delete photo |
| GET / PATCH / DELETE | /api/admin/messages[/:id] | Admin | List, moderate (approve/hide), delete message |
| GET / DELETE | /api/admin/rsvps[/:id] | Admin | List and manage guest RSVPs |
| GET | /api/admin/guests | Admin | Guest usage details |
| POST | /api/admin/guests/:id/reset | Admin | Reset a guest's quotas |
| GET / PATCH | /api/admin/settings | Admin | Upload toggles, close date, display toggle |
| POST | /api/admin/settings/regenerate-display-token | Admin | Generate new display link |
| GET | /api/admin/export | Admin | JSON export of all photos, messages, and RSVPs |
