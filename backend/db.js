import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(here, 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}

const newId = () => crypto.randomUUID();
const now = () => Date.now();

// Detect Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

let supabase = null;
let sqlite = null;

if (useSupabase) {
  console.log(`[Database] Connecting to Supabase at: ${SUPABASE_URL}`);
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
} else {
  console.log('[Database] Running in local SQLite mode. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env to use Supabase.');
  try {
    const { default: Database } = await import('better-sqlite3');
    const dbFile = process.env.DB_FILE || path.join(here, 'moments.db');
    sqlite = new Database(dbFile);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    // Initialize SQLite tables
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        file TEXT NOT NULL,
        author TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'hidden')),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 150),
        author TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'hidden')),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reactions (
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (photo_id, guest_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rsvps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        attending TEXT NOT NULL CHECK (attending IN ('yes', 'no')),
        count INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    try { sqlite.exec('ALTER TABLE photos ADD COLUMN author TEXT;'); } catch (_) {}
    try { sqlite.exec('ALTER TABLE messages ADD COLUMN author TEXT;'); } catch (_) {}
  } catch (err) {
    console.warn('[Database] SQLite not available in this environment.');
  }
}

export const isUsingSupabase = () => useSupabase;

// ---------- Settings ----------
export async function getSetting(key) {
  if (useSupabase) {
    const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? null;
  }
  return sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

export async function putSetting(key, value) {
  if (useSupabase) {
    await supabase.from('settings').upsert({ key, value: String(value) });
    return;
  }
  sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export async function initDefaultSettings(defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    const existing = await getSetting(key);
    if (existing === null) {
      await putSetting(key, value);
    }
  }
}

// ---------- Guests & Auth ----------
export async function createGuest(tokenHash) {
  const id = newId();
  if (useSupabase) {
    await supabase.from('guests').insert({ id, token_hash: tokenHash, created_at: new Date().toISOString() });
    return id;
  }
  sqlite.prepare('INSERT INTO guests (id, token_hash, created_at) VALUES (?, ?, ?)').run(id, tokenHash, now());
  return id;
}

export async function findGuestByTokenHash(tokenHash) {
  if (useSupabase) {
    const { data } = await supabase.from('guests').select('id').eq('token_hash', tokenHash).maybeSingle();
    return data?.id ?? null;
  }
  return sqlite.prepare('SELECT id FROM guests WHERE token_hash = ?').get(tokenHash)?.id ?? null;
}

export async function getGuestQuota(guestId, limits) {
  let photoCount = 0;
  let msgCount = 0;

  if (useSupabase) {
    const [{ count: pCount }, { count: mCount }] = await Promise.all([
      supabase.from('photos').select('*', { count: 'exact', head: true }).eq('guest_id', guestId),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('guest_id', guestId)
    ]);
    photoCount = pCount || 0;
    msgCount = mCount || 0;
  } else {
    photoCount = sqlite.prepare('SELECT COUNT(*) AS n FROM photos WHERE guest_id = ?').get(guestId).n;
    msgCount = sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE guest_id = ?').get(guestId).n;
  }

  return {
    photos: { used: photoCount, left: Math.max(0, limits.photos - photoCount) },
    messages: { used: msgCount, left: Math.max(0, limits.messages - msgCount) }
  };
}

// ---------- Photos ----------
export async function getApprovedPhotos() {
  if (useSupabase) {
    const { data } = await supabase
      .from('photos')
      .select('id, file_url, author, guest_id, created_at, reactions(photo_id)')
      .eq('status', 'approved')
      .order('created_at', { ascending: true });

    return (data || []).map(r => ({
      id: r.id,
      url: r.file_url,
      author: r.author || '',
      guestId: r.guest_id,
      createdAt: new Date(r.created_at).getTime(),
      likes: r.reactions?.length || 0
    }));
  }

  const rows = sqlite.prepare(`
    SELECT p.id, p.file, p.author, p.guest_id, p.created_at,
      (SELECT COUNT(*) FROM reactions r WHERE r.photo_id = p.id) AS likes
    FROM photos p WHERE p.status = 'approved' ORDER BY p.created_at ASC`).all();

  return rows.map(r => ({
    id: r.id,
    url: `/uploads/${r.file}`,
    author: r.author || '',
    guestId: r.guest_id,
    createdAt: r.created_at,
    likes: r.likes
  }));
}

export async function savePhoto({ guestId, filename, fileUrl, author, status, limit }) {
  if (useSupabase) {
    const { count } = await supabase.from('photos').select('*', { count: 'exact', head: true }).eq('guest_id', guestId);
    if ((count || 0) >= limit) throw Object.assign(new Error('LIMIT'), { limit: true });

    const id = newId();
    await supabase.from('photos').insert({
      id,
      guest_id: guestId,
      file_url: fileUrl,
      author: author || null,
      status,
      created_at: new Date().toISOString()
    });
    return id;
  }

  const save = sqlite.transaction(() => {
    const { n } = sqlite.prepare('SELECT COUNT(*) AS n FROM photos WHERE guest_id = ?').get(guestId);
    if (n >= limit) throw Object.assign(new Error('LIMIT'), { limit: true });
    const id = newId();
    sqlite.prepare('INSERT INTO photos (id, guest_id, file, author, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, guestId, filename, author || null, status, now());
    return id;
  });
  return save();
}

export async function deleteGuestPhoto(photoId, guestId) {
  if (useSupabase) {
    const { data } = await supabase.from('photos').select('file_url').eq('id', photoId).eq('guest_id', guestId).maybeSingle();
    if (!data) return false;
    await supabase.from('photos').delete().eq('id', photoId);
    return true;
  }

  const row = sqlite.prepare('SELECT file FROM photos WHERE id = ? AND guest_id = ?').get(photoId, guestId);
  if (!row) return false;
  sqlite.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, row.file)); } catch (_) {}
  return true;
}

export async function toggleLike(photoId, guestId) {
  if (useSupabase) {
    const { data: existing } = await supabase.from('reactions')
      .select('photo_id').eq('photo_id', photoId).eq('guest_id', guestId).maybeSingle();

    if (existing) {
      await supabase.from('reactions').delete().eq('photo_id', photoId).eq('guest_id', guestId);
    } else {
      await supabase.from('reactions').insert({ photo_id: photoId, guest_id: guestId, created_at: new Date().toISOString() });
    }
    const { count } = await supabase.from('reactions').select('*', { count: 'exact', head: true }).eq('photo_id', photoId);
    return { liked: !existing, likes: count || 0 };
  }

  const existing = sqlite.prepare('SELECT 1 FROM reactions WHERE photo_id = ? AND guest_id = ?').get(photoId, guestId);
  if (existing) {
    sqlite.prepare('DELETE FROM reactions WHERE photo_id = ? AND guest_id = ?').run(photoId, guestId);
  } else {
    sqlite.prepare('INSERT INTO reactions (photo_id, guest_id, created_at) VALUES (?, ?, ?)').run(photoId, guestId, now());
  }
  const { n } = sqlite.prepare('SELECT COUNT(*) AS n FROM reactions WHERE photo_id = ?').get(photoId);
  return { liked: !existing, likes: n };
}

// ---------- Messages ----------
export async function getApprovedMessages() {
  if (useSupabase) {
    const { data } = await supabase
      .from('messages')
      .select('id, text, author, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: true });

    return (data || []).map(r => ({
      id: r.id,
      text: r.text,
      author: r.author || '',
      createdAt: new Date(r.created_at).getTime()
    }));
  }

  const rows = sqlite.prepare("SELECT id, text, author, created_at FROM messages WHERE status = 'approved' ORDER BY created_at ASC").all();
  return rows.map(r => ({ id: r.id, text: r.text, author: r.author || '', createdAt: r.created_at }));
}

export async function saveMessage({ guestId, text, author, status, limit }) {
  if (useSupabase) {
    const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('guest_id', guestId);
    if ((count || 0) >= limit) throw Object.assign(new Error('LIMIT'), { limit: true });

    const id = newId();
    await supabase.from('messages').insert({
      id,
      guest_id: guestId,
      text,
      author: author || null,
      status,
      created_at: new Date().toISOString()
    });
    return id;
  }

  const save = sqlite.transaction(() => {
    const { n } = sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE guest_id = ?').get(guestId);
    if (n >= limit) throw Object.assign(new Error('LIMIT'), { limit: true });
    const id = newId();
    sqlite.prepare('INSERT INTO messages (id, guest_id, text, author, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, guestId, text, author || null, status, now());
    return id;
  });
  return save();
}

// ---------- RSVPs ----------
export async function saveRsvp({ name, attending, count, notes }) {
  const id = newId();
  if (useSupabase) {
    await supabase.from('rsvps').insert({
      id,
      name,
      attending,
      count,
      notes: notes || null,
      created_at: new Date().toISOString()
    });
    return id;
  }

  sqlite.prepare('INSERT INTO rsvps (id, name, attending, count, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, attending, count, notes || null, now());
  return id;
}

export async function getAllRsvps() {
  if (useSupabase) {
    const { data } = await supabase.from('rsvps').select('*').order('created_at', { ascending: false });
    const rows = (data || []).map(r => ({
      id: r.id,
      name: r.name,
      attending: r.attending,
      count: r.count,
      notes: r.notes || '',
      createdAt: new Date(r.created_at).getTime()
    }));

    const totalResponses = rows.length;
    const attendingYes = rows.filter(r => r.attending === 'yes').length;
    const attendingNo = rows.filter(r => r.attending === 'no').length;
    const totalGuests = rows.filter(r => r.attending === 'yes').reduce((sum, r) => sum + r.count, 0);

    return { summary: { totalResponses, attendingYes, attendingNo, totalGuests }, rsvps: rows };
  }

  const rows = sqlite.prepare('SELECT id, name, attending, count, notes, created_at FROM rsvps ORDER BY created_at DESC').all();
  const totalResponses = rows.length;
  const attendingYes = rows.filter(r => r.attending === 'yes').length;
  const attendingNo = rows.filter(r => r.attending === 'no').length;
  const totalGuests = rows.filter(r => r.attending === 'yes').reduce((sum, r) => sum + r.count, 0);

  return { summary: { totalResponses, attendingYes, attendingNo, totalGuests }, rsvps: rows };
}

export async function deleteRsvp(id) {
  if (useSupabase) {
    await supabase.from('rsvps').delete().eq('id', id);
    return;
  }
  sqlite.prepare('DELETE FROM rsvps WHERE id = ?').run(id);
}

// ---------- Admin Sessions & Moderation ----------
export async function createAdminSession(tokenHash, expiresAt) {
  if (useSupabase) {
    await supabase.from('admin_sessions').insert({ token_hash: tokenHash, expires_at: expiresAt });
    return;
  }
  sqlite.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)').run(tokenHash, expiresAt);
}

export async function verifyAdminSession(tokenHash) {
  if (useSupabase) {
    const { data } = await supabase.from('admin_sessions').select('token_hash')
      .eq('token_hash', tokenHash).gt('expires_at', now()).maybeSingle();
    return Boolean(data);
  }
  return Boolean(sqlite.prepare('SELECT 1 FROM admin_sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now()));
}

export async function getAdminSummary() {
  if (useSupabase) {
    const [p, pPending, m, mPending, g, r] = await Promise.all([
      supabase.from('photos').select('*', { count: 'exact', head: true }),
      supabase.from('photos').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('messages').select('*', { count: 'exact', head: true }),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('guests').select('*', { count: 'exact', head: true }),
      supabase.from('rsvps').select('*', { count: 'exact', head: true })
    ]);
    return {
      photos: p.count || 0,
      pendingPhotos: pPending.count || 0,
      messages: m.count || 0,
      pendingMessages: mPending.count || 0,
      guests: g.count || 0,
      rsvps: r.count || 0
    };
  }

  const count = sql => sqlite.prepare(sql).get()?.n ?? 0;
  return {
    photos: count('SELECT COUNT(*) AS n FROM photos'),
    pendingPhotos: count("SELECT COUNT(*) AS n FROM photos WHERE status = 'pending'"),
    messages: count('SELECT COUNT(*) AS n FROM messages'),
    pendingMessages: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'pending'"),
    guests: count('SELECT COUNT(*) AS n FROM guests'),
    rsvps: count('SELECT COUNT(*) AS n FROM rsvps')
  };
}

export async function getAdminPhotos(status) {
  if (useSupabase) {
    let query = supabase.from('photos').select('id, file_url, author, status, created_at, guest_id').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return (data || []).map(r => ({
      id: r.id,
      url: r.file_url,
      author: r.author || '',
      status: r.status,
      createdAt: new Date(r.created_at).getTime(),
      guest: (r.guest_id || '').slice(0, 6)
    }));
  }

  const rows = sqlite.prepare(`
    SELECT p.id, p.file, p.author, p.status, p.created_at, substr(p.guest_id, 1, 6) AS guest
    FROM photos p
    WHERE (? IS NULL OR p.status = ?)
    ORDER BY p.created_at DESC`).all(status ?? null, status ?? null);

  return rows.map(r => ({
    id: r.id,
    url: `/uploads/${r.file}`,
    author: r.author || '',
    status: r.status,
    createdAt: r.created_at,
    guest: r.guest
  }));
}

export async function updatePhotoStatus(id, status) {
  if (useSupabase) {
    const { error } = await supabase.from('photos').update({ status }).eq('id', id);
    return !error;
  }
  const result = sqlite.prepare('UPDATE photos SET status = ? WHERE id = ?').run(status, id);
  return result.changes > 0;
}

export async function deletePhoto(id) {
  if (useSupabase) {
    await supabase.from('photos').delete().eq('id', id);
    return true;
  }
  const row = sqlite.prepare('SELECT file FROM photos WHERE id = ?').get(id);
  if (!row) return false;
  sqlite.prepare('DELETE FROM photos WHERE id = ?').run(id);
  try { fs.unlinkSync(path.join(UPLOAD_DIR, row.file)); } catch (_) {}
  return true;
}

export async function getAdminMessages(status) {
  if (useSupabase) {
    let query = supabase.from('messages').select('id, text, author, status, created_at, guest_id').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data } = await query;
    return (data || []).map(r => ({
      id: r.id,
      text: r.text,
      author: r.author || '',
      status: r.status,
      createdAt: new Date(r.created_at).getTime(),
      guest: (r.guest_id || '').slice(0, 6)
    }));
  }

  const rows = sqlite.prepare(`
    SELECT id, text, author, status, created_at, substr(guest_id, 1, 6) AS guest
    FROM messages WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC`).all(status ?? null, status ?? null);

  return rows.map(r => ({
    id: r.id,
    text: r.text,
    author: r.author || '',
    status: r.status,
    createdAt: r.created_at,
    guest: r.guest
  }));
}

export async function updateMessageStatus(id, status) {
  if (useSupabase) {
    const { error } = await supabase.from('messages').update({ status }).eq('id', id);
    return !error;
  }
  const result = sqlite.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
  return result.changes > 0;
}

export async function deleteMessage(id) {
  if (useSupabase) {
    await supabase.from('messages').delete().eq('id', id);
    return true;
  }
  sqlite.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return true;
}

export async function getAdminGuests() {
  if (useSupabase) {
    const { data: guests } = await supabase.from('guests').select('id, created_at').order('created_at', { ascending: false });
    const { data: photos } = await supabase.from('photos').select('guest_id');
    const { data: messages } = await supabase.from('messages').select('guest_id');

    const photoCounts = {};
    (photos || []).forEach(p => { photoCounts[p.guest_id] = (photoCounts[p.guest_id] || 0) + 1; });
    const msgCounts = {};
    (messages || []).forEach(m => { msgCounts[m.guest_id] = (msgCounts[m.guest_id] || 0) + 1; });

    return (guests || []).map(g => ({
      id: g.id,
      guest: g.id.slice(0, 6),
      joinedAt: new Date(g.created_at).getTime(),
      photos: photoCounts[g.id] || 0,
      messages: msgCounts[g.id] || 0
    }));
  }

  const rows = sqlite.prepare(`
    SELECT g.id, g.created_at,
      (SELECT COUNT(*) FROM photos p WHERE p.guest_id = g.id) AS photos,
      (SELECT COUNT(*) FROM messages m WHERE m.guest_id = g.id) AS messages
    FROM guests g ORDER BY g.created_at DESC`).all();

  return rows.map(r => ({ id: r.id, guest: r.id.slice(0, 6), joinedAt: r.created_at, photos: r.photos, messages: r.messages }));
}

export async function resetGuest(guestId) {
  if (useSupabase) {
    await Promise.all([
      supabase.from('messages').delete().eq('guest_id', guestId),
      supabase.from('photos').delete().eq('guest_id', guestId)
    ]);
    return true;
  }

  const files = sqlite.prepare('SELECT file FROM photos WHERE guest_id = ?').all(guestId);
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM messages WHERE guest_id = ?').run(guestId);
    sqlite.prepare('DELETE FROM photos WHERE guest_id = ?').run(guestId);
  })();
  files.forEach(f => {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, f.file)); } catch (_) {}
  });
  return true;
}

// Upload photo to Supabase Storage or local disk
export async function storePhotoFile(file) {
  const ext = file.mimetype === 'image/png' ? '.png' :
              file.mimetype === 'image/webp' ? '.webp' :
              file.mimetype === 'image/heic' ? '.heic' : '.jpg';
  const filename = `${newId()}${ext}`;

  if (useSupabase) {
    const { data, error } = await supabase.storage
      .from('wedding-photos')
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) throw error;
    const { data: publicUrlData } = supabase.storage.from('wedding-photos').getPublicUrl(data.path);
    return { filename, fileUrl: publicUrlData.publicUrl };
  }

  // Local fallback disk write
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return { filename, fileUrl: `/uploads/${filename}` };
}
