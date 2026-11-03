# Wedding Moments: Setup & Running Guide

## What is in this project
- **`web/invite.html`**: The interactive wedding invitation (animated envelope opening, countdown, save the date, and RSVP form).
- **`web/upload.html`**: The guest wall where guests pin photos and post sticky notes with their signature.
- **`web/display.html`**: Full-screen venue projector display with live Wall Mode and Slideshow Mode.
- **`web/admin.html`**: Organisers' dashboard for reviewing photos, approving messages, managing RSVPs, tracking guest quotas, and exporting all data.
- **`backend/`**: Express & SQLite server with transactional quota enforcement and file upload handling.

---

## 1. Quick Start

### 1.1 Start the backend server
In the terminal:

```powershell
cd backend
npm install
npm start
```

The server automatically loads environment settings from `backend/.env` (configured by default for development):
- **Event Guest Code**: `ruthandelvis2026`
- **Admin Passcode**: `moments`
- **Port**: `3000`

### 1.2 Open the application
Open your browser to:
- **Invitation**: [http://localhost:3000/invite](http://localhost:3000/invite) (or simply [http://localhost:3000/](http://localhost:3000/))
- **Upload Wall**: [http://localhost:3000/upload](http://localhost:3000/upload)
- **Venue Display**: [http://localhost:3000/display](http://localhost:3000/display)
- **Admin Dashboard**: [http://localhost:3000/admin](http://localhost:3000/admin)

### 1.3 Connecting to Supabase (Cloud Deployment)
1. In your Supabase dashboard, run [`backend/supabase_schema.sql`](backend/supabase_schema.sql) in the SQL Editor.
2. Add your project credentials to `backend/.env`:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
3. Restart the server. The database layer automatically detects Supabase, switching all data to PostgreSQL and photos to Supabase Storage!

---

## 2. Customization Before the Wedding

1. **Invitation Time & Deadline**:
   - In `web/invite.html`, update `INVITE.time` and `INVITE.rsvpBy` when final times are confirmed.
2. **Couple Photo**:
   - Place the photo in `web/images/` and set `INVITE.photo = "images/couple.jpg"` in `web/invite.html`.
3. **Change Production Codes**:
   - In `backend/.env`, update `EVENT_CODE` and `ADMIN_CODE` to strong private values before deploying.
4. **Venue Projector Screen**:
   - In `web/admin.html` > Settings, copy the generated **Display Link** and open it on the venue laptop. You can toggle between **Wall Mode** (masonry brick layout) and **Slideshow Mode** (large rotating photos).

---

## 3. Stopping the Server
Press `Ctrl + C` in the terminal to stop the server.
