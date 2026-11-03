# Wedding Moments

A private wedding web application featuring an interactive invitation with RSVP, a real-time guest photo and message wall, a full-screen venue projector display, and an organizer dashboard.

## Pages

- **Invitation & RSVP**: `/invite`
- **Guest Wall**: `/upload`
- **Venue Display**: `/display`
- **Admin Dashboard**: `/admin` (Default passcode: `moments`)

## Local Development

Prerequisites: Node.js 20 or higher.

```bash
npm install
npm start
```

The application runs on `http://localhost:3000`. By default, it operates with local SQLite and file storage.

## Deployment

### 1. Database and Storage Setup (Supabase)

1. Open your Supabase project SQL Editor.
2. Execute the contents of `backend/supabase_schema.sql` to create the required tables and the `wedding-photos` storage bucket.

### 2. Deploy to Vercel

1. Push this repository to GitHub:
   ```bash
   git remote add origin https://github.com/USERNAME/REPOSITORY.git
   git push -u origin main
   ```
2. Import the repository in Vercel.
3. Configure the following environment variables:
   - `EVENT_CODE`: Guest join code (default: `ruthandelvis2026`)
   - `ADMIN_CODE`: Dashboard access passcode
   - `SUPABASE_URL`: Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role secret key
4. Deploy.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Local server port |
| `EVENT_CODE` | No | `ruthandelvis2026` | Guest access code |
| `ADMIN_CODE` | No | `moments` | Admin dashboard passcode |
| `SUPABASE_URL` | For production | None | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For production | None | Supabase service role key |
