# Moments Backend API

API server powering the wedding moments platform. Supports local SQLite for development and Supabase PostgreSQL with Storage for production.

## Running

```bash
npm install
npm start
```

## API Endpoints

### Public and Guest
- `GET /api/quote`: Random wedding quote
- `POST /api/rsvp`: Submit guest RSVP
- `POST /api/join`: Exchange event code for guest bearer token
- `GET /api/me`: Current guest remaining photo and message quotas
- `GET /api/photos`: List approved photos
- `POST /api/photos`: Upload a photo (max 10 per guest, up to 5 MB)
- `DELETE /api/photos/:id`: Remove own uploaded photo
- `POST /api/photos/:id/like`: Toggle like on a photo
- `GET /api/messages`: List approved sticky notes
- `POST /api/messages`: Post a sticky note (max 2 per guest, up to 150 chars)

### Venue Display
- `GET /api/display/:token/photos`: Slideshow feed
- `GET /api/display/:token/wall`: Masonry grid feed

### Admin
- `POST /api/admin/login`: Admin authentication
- `GET /api/admin/summary`: Overview statistics
- `GET/PATCH/DELETE /api/admin/photos`: Photo moderation
- `GET/PATCH/DELETE /api/admin/messages`: Note moderation
- `GET/DELETE /api/admin/rsvps`: RSVP management and CSV export
- `GET/POST /api/admin/guests`: View usage and reset limits
- `GET/PATCH /api/admin/settings`: Toggles and deadline configuration
- `GET /api/admin/export`: Complete JSON data archive
