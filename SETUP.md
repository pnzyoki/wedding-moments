# Wedding Moments: Setup & Deployment Guide

## What is in this project
- **`web/invite.html`**: The interactive wedding invitation (animated envelope opening, countdown, save the date, and RSVP form).
- **`web/upload.html`**: The guest wall where guests pin photos and post sticky notes with their signature.
- **`web/display.html`**: Full-screen venue projector display with live Wall Mode and Slideshow Mode.
- **`web/admin.html`**: Organisers' dashboard for reviewing photos, approving messages, managing RSVPs, tracking guest quotas, and exporting all data.
- **`backend/`**: Express API server with transactional limits, Supabase PostgreSQL, and cloud photo storage.
- **`vercel.json` & `api/index.js`**: Native serverless configuration for 1-click deployment on Vercel.

---

## 1. Quick Start (Local Development)

### 1.1 Start the server
In the project root or backend folder:

```powershell
npm install
npm start
```

### 1.2 Open the application
- **Invitation**: [http://localhost:3000/invite](http://localhost:3000/invite)
- **Upload Wall**: [http://localhost:3000/upload](http://localhost:3000/upload)
- **Venue Display**: [http://localhost:3000/display](http://localhost:3000/display)
- **Admin Dashboard**: [http://localhost:3000/admin](http://localhost:3000/admin) *(Passcode: `moments`)*

---

## 2. Deploy to GitHub & Vercel

### Step 2.1: Push to GitHub
1. Create a new repository on [GitHub](https://github.com/new) (e.g. `wedding-moments`).
2. In your terminal, link and push your code:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/wedding-moments.git
   git push -u origin main
   ```

### Step 2.2: Setup Supabase Database & Storage
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) and open the **SQL Editor**.
2. Run the script [`backend/supabase_schema.sql`](backend/supabase_schema.sql). This will create all tables, RLS security policies, and the `wedding-photos` storage bucket.

### Step 2.3: Deploy on Vercel
1. Go to [vercel.com/new](https://vercel.com/new) and click **Import** next to your `wedding-moments` repository.
2. Under **Environment Variables**, add:
   - `EVENT_CODE` = `ruthandelvis2026`
   - `ADMIN_CODE` = *(choose your private admin passcode)*
   - `SUPABASE_URL` = `https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = *(from Supabase Project Settings > API)*
3. Click **Deploy**! Vercel will build and launch your live wedding site with automatic HTTPS and global edge CDN.

---

## 3. Customization Before the Wedding

1. **Invitation Time & Deadline**:
   - In `web/invite.html`, update `INVITE.time` and `INVITE.rsvpBy` when final times are confirmed.
2. **Couple Photo**:
   - Place the photo in `web/images/` and set `INVITE.photo = "images/couple.jpg"` in `web/invite.html`.
3. **Change Production Passcodes**:
   - Set strong values for `EVENT_CODE` and `ADMIN_CODE` in your Vercel Environment Variables.
4. **Venue Projector Screen**:
   - In `web/admin.html` > Settings, copy the generated **Display Link** and open it on the venue laptop. You can toggle between **Wall Mode** (masonry brick layout) and **Slideshow Mode** (large rotating photos).

---

## 4. Stopping the Local Server
Press `Ctrl + C` in the terminal to stop the local development server.
