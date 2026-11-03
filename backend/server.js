import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUOTES } from './quotes.js';
import * as db from './db.js';

// Security headers middleware
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let supabaseOrigin = '';
  try { if (rawUrl) supabaseOrigin = new URL(rawUrl).origin; } catch (_) {}
  const imgSrc = `'self' ${supabaseOrigin} https://*.supabase.co https://*.supabase.in blob: data: https:`;

  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src ${imgSrc}; connect-src 'self' ${supabaseOrigin} https://*.supabase.co; frame-src https://www.google.com https://maps.google.com; frame-ancestors 'none';`
  );
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
}

const here = path.dirname(fileURLToPath(import.meta.url));

// Load .env (Node 20+)
if (typeof process.loadEnvFile === 'function') {
  try { process.loadEnvFile(); } catch {
    try { process.loadEnvFile(path.join(here, '.env')); } catch (_) {}
  }
}

// Configuration
const PORT = Number(process.env.PORT || 3000);
const EVENT_CODE = process.env.EVENT_CODE || 'ruthandelvis2026';
const ADMIN_CODE = process.env.ADMIN_CODE || 'moments';
const LIMITS = { photos: 10, messages: 2, chars: 150, photoMB: 5, authorChars: 50 };
const ADMIN_SESSION_HOURS = 8;

const newToken = () => crypto.randomBytes(24).toString('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => Date.now();

// Strip HTML tags and dangerous characters from user text
function sanitize(str, maxLen = 500) {
  return String(str ?? '')
    .replace(/[<>"'`]/g, c => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]))
    .trim()
    .slice(0, maxLen);
}

function safeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hashB = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Initialize default event settings (only when a database is available)
try {
  await db.initDefaultSettings({
    uploads_open: '1',
    require_approval: '1',
    display_on: '1',
    close_date: '',
    display_token: newToken().slice(0, 16)
  });
} catch (err) {
  if (!String(err.message).includes('No database')) throw err;
  console.warn('[Server] Skipping default settings init — no database configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

async function uploadBlock() {
  if (await db.getSetting('uploads_open') !== '1') return 'Uploads are paused right now.';
  const close = await db.getSetting('close_date');
  if (close && now() > Date.parse(close) + 86_399_999) return 'Uploads have closed. Thank you for sharing!';
  return null;
}

async function initialStatus() {
  return (await db.getSetting('require_approval')) === '1' ? 'pending' : 'approved';
}

// In-memory multer upload handler
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.photoMB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED.has(file.mimetype))
});

// Auth middlewares
const bearer = req => (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

async function requireGuest(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Join the event with your code first.' });
  const guestId = await db.findGuestByTokenHash(sha(token));
  if (!guestId) return res.status(401).json({ error: 'Session expired. Please join again with the event code.' });
  req.guestId = guestId;
  next();
}

const ADMIN_SECRET = crypto.createHash('sha256').update(ADMIN_CODE + ':admin-token-salt').digest();

function createAdminToken() {
  const expires = Date.now() + ADMIN_SESSION_HOURS * 3_600_000;
  const payload = Buffer.from(JSON.stringify({ exp: expires })).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  if (sig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Admin sign-in required.' });
  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Admin session expired. Please sign in again.' });
  next();
}

// Rate limiting
const attempts = new Map();
function rateLimit(prefix, maxHits = 15, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `${prefix}:${ip}`;
    const entry = attempts.get(key) || { count: 0, resetAt: now() + windowMs };
    if (now() > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now() + windowMs;
    }
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > maxHits) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    next();
  };
}

// App setup
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Security headers (applied before CORS so headers are always set)
app.use(securityHeaders);

// CORS — restrict to the deployed origin in production
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGIN
    ? origin === ALLOWED_ORIGIN
    : true; // permissive in local dev when not set
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!ALLOWED_ORIGIN) {
    // local dev fallback — allow all
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static uploads (for local mode fallback)
app.use('/uploads', express.static(path.join(here, 'uploads'), { maxAge: '30d', immutable: true, index: false }));

// Static frontend pages
const webDir = path.join(here, '../web');
app.use(express.static(webDir));
app.get('/', (_req, res) => res.redirect('/invite.html'));
app.get('/invite', (_req, res) => res.redirect('/invite.html'));
app.get('/upload', (_req, res) => res.redirect('/upload.html'));
app.get('/display', (_req, res) => res.redirect('/display.html'));
app.get('/admin', (_req, res) => res.redirect('/admin.html'));

// Public Quotes
app.get('/api/quote', (_req, res) => {
  res.json(QUOTES[crypto.randomInt(QUOTES.length)]);
});

// Join Event
app.post('/api/join', rateLimit('join', 20), async (req, res) => {
  if (!safeEqual(req.body?.code ?? '', EVENT_CODE)) {
    return res.status(403).json({ error: 'That code is not right.' });
  }
  const token = newToken();
  await db.createGuest(sha(token));
  res.status(201).json({ token, limits: { photos: LIMITS.photos, messages: LIMITS.messages, chars: LIMITS.chars } });
});

// Current Guest Quota
app.get('/api/me', requireGuest, async (req, res) => {
  const quota = await db.getGuestQuota(req.guestId, LIMITS);
  res.json({
    guestId: req.guestId,
    photos: quota.photos,
    messages: quota.messages,
    uploadsOpen: (await uploadBlock()) === null
  });
});

// Approved Photos
app.get('/api/photos', async (_req, res) => {
  const photos = await db.getApprovedPhotos();
  res.json(photos);
});

// Photo view proxy — guaranteed same-origin image delivery without cross-origin or CSP friction
app.get('/api/photo-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return res.status(400).send('Invalid url');
  }
  try {
    const target = new URL(url);
    if (!target.hostname.endsWith('supabase.co')) {
      return res.status(403).send('Forbidden');
    }
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).send('Upstream error');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(500).send('Proxy error');
  }
});

// Upload Photo
app.post('/api/photos', requireGuest, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, WebP or HEIC image.' });
  const block = await uploadBlock();
  if (block) return res.status(403).json({ error: block });

  const author = sanitize(req.body?.author ?? '', LIMITS.authorChars);
  const status = await initialStatus();

  try {
    const { filename, fileUrl } = await db.storePhotoFile(req.file);
    const id = await db.savePhoto({
      guestId: req.guestId,
      filename,
      fileUrl,
      author,
      status,
      limit: LIMITS.photos
    });
    res.status(201).json({ id, status, author, url: fileUrl });
  } catch (err) {
    if (err.limit) return res.status(409).json({ error: `You have used all ${LIMITS.photos} photos.` });
    console.error('Photo save error:', err);
    res.status(500).json({ error: 'Could not upload photo. Please try again.' });
  }
});

// Remove Own Photo
app.delete('/api/photos/:id', requireGuest, async (req, res) => {
  const success = await db.deleteGuestPhoto(req.params.id, req.guestId);
  if (!success) return res.status(404).json({ error: 'Photo not found.' });
  res.status(204).end();
});

// Like / Unlike Photo
app.post('/api/photos/:id/like', requireGuest, async (req, res) => {
  const result = await db.toggleLike(req.params.id, req.guestId);
  res.json(result);
});

// Approved Messages
app.get('/api/messages', async (_req, res) => {
  const messages = await db.getApprovedMessages();
  res.json(messages);
});

// Post Sticky Note
app.post('/api/messages', requireGuest, async (req, res) => {
  const block = await uploadBlock();
  if (block) return res.status(403).json({ error: block });
  const text = sanitize(req.body?.text ?? '', LIMITS.chars);
  const author = sanitize(req.body?.author ?? '', LIMITS.authorChars);
  if (!text) return res.status(400).json({ error: 'Please write a message first.' });
  if ([...text].length > LIMITS.chars) {
    return res.status(400).json({ error: `Keep it under ${LIMITS.chars} characters.` });
  }

  const status = await initialStatus();
  try {
    const id = await db.saveMessage({
      guestId: req.guestId,
      text,
      author,
      status,
      limit: LIMITS.messages
    });
    res.status(201).json({ id, status, author });
  } catch (err) {
    if (err.limit) return res.status(409).json({ error: `You have used your ${LIMITS.messages} messages.` });
    throw err;
  }
});

// RSVP
app.post('/api/rsvp', rateLimit('rsvp', 30), async (req, res) => {
  const name = sanitize(req.body?.name ?? '', 200);
  const attending = req.body?.attending === 'no' ? 'no' : 'yes';
  const count = Math.max(1, Math.min(10, Number(req.body?.count) || 1));
  const notes = sanitize(req.body?.notes ?? '', 500);

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });

  try {
    const id = await db.saveRsvp({ name, attending, count, notes });
    res.status(201).json({ ok: true, id, name, attending, count });
  } catch (err) {
    console.error('RSVP save error:', err.message);
    res.status(500).json({ error: 'Could not save your RSVP. Please try again.' });
  }
});

// Venue Display Feed
app.get('/api/display/:token/photos', async (req, res) => {
  const tokenOk = safeEqual(req.params.token, await db.getSetting('display_token'));
  if (!tokenOk || (await db.getSetting('display_on')) !== '1') {
    return res.status(404).json({ error: 'Not available.' });
  }
  const photos = await db.getApprovedPhotos();
  res.json(photos.map(p => ({ url: p.url, author: p.author, createdAt: p.createdAt })));
});

app.get('/api/display/:token/wall', async (req, res) => {
  const tokenOk = safeEqual(req.params.token, await db.getSetting('display_token'));
  if (!tokenOk || (await db.getSetting('display_on')) !== '1') {
    return res.status(404).json({ error: 'Not available.' });
  }
  const [photos, messages] = await Promise.all([
    db.getApprovedPhotos(),
    db.getApprovedMessages()
  ]);
  res.json({ photos, messages });
});

// Admin Login (stateless HMAC token)
app.post('/api/admin/login', rateLimit('admin-login', 10), (req, res) => {
  if (!safeEqual(req.body?.code ?? '', ADMIN_CODE)) {
    return res.status(403).json({ error: 'That passcode is not right.' });
  }
  const token = createAdminToken();
  res.json({ token, expiresInHours: ADMIN_SESSION_HOURS });
});

// Admin Summary
app.get('/api/admin/summary', requireAdmin, async (_req, res) => {
  const summary = await db.getAdminSummary();
  res.json(summary);
});

// Admin Photos
app.get('/api/admin/photos', requireAdmin, async (req, res) => {
  const photos = await db.getAdminPhotos(req.query.status);
  res.json(photos);
});

app.patch('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  const valid = new Set(['pending', 'approved', 'hidden']);
  if (!valid.has(req.body?.status)) return res.status(400).json({ error: 'Invalid status.' });
  const success = await db.updatePhotoStatus(req.params.id, req.body.status);
  if (!success) return res.status(404).json({ error: 'Photo not found.' });
  res.json({ ok: true });
});

app.delete('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  await db.deletePhoto(req.params.id);
  res.status(204).end();
});

// Admin Messages
app.get('/api/admin/messages', requireAdmin, async (req, res) => {
  const msgs = await db.getAdminMessages(req.query.status);
  res.json(msgs);
});

app.patch('/api/admin/messages/:id', requireAdmin, async (req, res) => {
  const valid = new Set(['pending', 'approved', 'hidden']);
  if (!valid.has(req.body?.status)) return res.status(400).json({ error: 'Invalid status.' });
  const success = await db.updateMessageStatus(req.params.id, req.body.status);
  if (!success) return res.status(404).json({ error: 'Message not found.' });
  res.json({ ok: true });
});

app.delete('/api/admin/messages/:id', requireAdmin, async (req, res) => {
  await db.deleteMessage(req.params.id);
  res.status(204).end();
});

// Admin RSVPs
app.get('/api/admin/rsvps', requireAdmin, async (_req, res) => {
  const result = await db.getAllRsvps();
  res.json(result);
});

app.delete('/api/admin/rsvps/:id', requireAdmin, async (req, res) => {
  await db.deleteRsvp(req.params.id);
  res.status(204).end();
});

// Admin Guests
app.get('/api/admin/guests', requireAdmin, async (_req, res) => {
  const guests = await db.getAdminGuests();
  res.json(guests);
});

app.post('/api/admin/guests/:id/reset', requireAdmin, async (req, res) => {
  await db.resetGuest(req.params.id);
  res.json({ ok: true });
});

// Admin Settings
app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    res.json({
      uploadsOpen: (await db.getSetting('uploads_open')) === '1',
      requireApproval: (await db.getSetting('require_approval')) === '1',
      displayOn: (await db.getSetting('display_on')) === '1',
      closeDate: (await db.getSetting('close_date')) || '',
      displayToken: (await db.getSetting('display_token')) || 'default-token',
      dbDriver: db.isUsingSupabase() ? 'supabase' : 'sqlite'
    });
  } catch (err) {
    res.json({
      uploadsOpen: true,
      requireApproval: true,
      displayOn: true,
      closeDate: '',
      displayToken: 'default-token',
      dbDriver: 'none'
    });
  }
});

const SETTING_KEYS = {
  uploadsOpen: ['uploads_open', v => (v ? '1' : '0')],
  requireApproval: ['require_approval', v => (v ? '1' : '0')],
  displayOn: ['display_on', v => (v ? '1' : '0')],
  closeDate: ['close_date', v => (/^\d{4}-\d{2}-\d{2}$/.test(v) || v === '' ? v : null)]
};

app.patch('/api/admin/settings', requireAdmin, async (req, res) => {
  for (const [field, value] of Object.entries(req.body ?? {})) {
    const rule = SETTING_KEYS[field];
    if (!rule) continue;
    const stored = rule[1](value);
    if (stored === null) return res.status(400).json({ error: 'Close date must be YYYY-MM-DD.' });
    await db.putSetting(rule[0], stored);
  }
  res.json({ ok: true });
});

app.post('/api/admin/settings/regenerate-display-token', requireAdmin, async (_req, res) => {
  const token = newToken().slice(0, 16);
  await db.putSetting('display_token', token);
  res.json({ displayToken: token });
});

// Export all data
app.get('/api/admin/export', requireAdmin, async (_req, res) => {
  const [photos, messages, rsvpData] = await Promise.all([
    db.getApprovedPhotos(),
    db.getApprovedMessages(),
    db.getAllRsvps()
  ]);
  res.setHeader('Content-Disposition', 'attachment; filename="wedding-moments-export.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    photos,
    messages,
    rsvps: rsvpData.rsvps
  });
});

// Error handler
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `That photo is larger than ${LIMITS.photoMB} MB.`
      : 'Upload failed. Please try again.';
    return res.status(400).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Moments server listening on http://localhost:${PORT}`);
  });
}

export default app;
