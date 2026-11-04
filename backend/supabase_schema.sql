-- ====================================================================
-- Wedding Moments: Supabase (PostgreSQL) Schema & Setup
-- Ruth & Elvis Wedding (November 14, 2026)
-- Safe to run repeatedly (Idempotent)
-- ====================================================================

-- 1. Enable pgcrypto / uuid-ossp for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. RSVPs Table
CREATE TABLE IF NOT EXISTS public.rsvps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  attending   TEXT NOT NULL CHECK (attending IN ('yes', 'no')),
  count       INTEGER NOT NULL DEFAULT 1 CHECK (count BETWEEN 0 AND 10),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rsvps_created ON public.rsvps(created_at DESC);

-- Ensure count allows 0 if table already exists
ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_count_check;
ALTER TABLE public.rsvps ADD CONSTRAINT rsvps_count_check CHECK (count BETWEEN 0 AND 10);

-- 3. Guests Table (Identified by token hash)
CREATE TABLE IF NOT EXISTS public.guests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Photos Table
CREATE TABLE IF NOT EXISTS public.photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  file_url    TEXT NOT NULL,
  author      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_status ON public.photos(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_photos_guest  ON public.photos(guest_id);

-- 5. Messages Table (Sticky Notes)
CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  text        TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 150),
  author      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON public.messages(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_guest  ON public.messages(guest_id);

-- 6. Reactions Table (Likes)
CREATE TABLE IF NOT EXISTS public.reactions (
  photo_id    UUID NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  guest_id    UUID NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, guest_id)
);

-- 7. Settings Table
CREATE TABLE IF NOT EXISTS public.settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- 8. Admin Sessions Table
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  expires_at  BIGINT NOT NULL
);

-- Default Settings (Inserted only if missing)
INSERT INTO public.settings (key, value)
VALUES 
  ('uploads_open', '1'),
  ('require_approval', '1'),
  ('display_on', '1'),
  ('close_date', ''),
  ('display_token', encode(gen_random_bytes(12), 'hex'))
ON CONFLICT (key) DO NOTHING;

-- ====================================================================
-- Realtime Subscriptions (Safely add if not already present)
-- ====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'photos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.photos;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ====================================================================
-- Storage Bucket Setup for Wedding Photos
-- ====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wedding-photos',
  'wedding-photos',
  true,
  5242880, -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- ====================================================================
-- Row Level Security (RLS) Policies (Drop first then re-create)
-- ====================================================================
ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- RSVPs: Anyone can insert; service role reads/admin
DROP POLICY IF EXISTS "Public can submit RSVPs" ON public.rsvps;
CREATE POLICY "Public can submit RSVPs" ON public.rsvps
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Photos: Public can view approved photos
DROP POLICY IF EXISTS "Public can view approved photos" ON public.photos;
CREATE POLICY "Public can view approved photos" ON public.photos
  FOR SELECT TO anon, authenticated USING (status = 'approved');

-- Messages: Public can view approved messages
DROP POLICY IF EXISTS "Public can view approved messages" ON public.messages;
CREATE POLICY "Public can view approved messages" ON public.messages
  FOR SELECT TO anon, authenticated USING (status = 'approved');

-- Reactions: Public can read reactions count
DROP POLICY IF EXISTS "Public can view reactions" ON public.reactions;
CREATE POLICY "Public can view reactions" ON public.reactions
  FOR SELECT TO anon, authenticated USING (true);

-- Storage: Public can read photos from the bucket
DROP POLICY IF EXISTS "Public can view photos in storage" ON storage.objects;
CREATE POLICY "Public can view photos in storage" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'wedding-photos');
