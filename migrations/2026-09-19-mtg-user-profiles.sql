-- migrations/2026-09-19-mtg-user-profiles.sql
--
-- MTGPrices-specific profile data. Independent of Supabase auth because
-- auth.users is shared with Poképrices: deleting an MTGPrices profile
-- must NOT delete the auth identity.
--
-- Fields:
--   user_id       auth.uid() PK. FK to auth.users with ON DELETE CASCADE
--                 so that if the shared auth identity is ever deleted
--                 (e.g. GDPR erase across sibling products), the MTG
--                 profile row goes with it. The reverse direction
--                 (delete MTG profile only) is handled by the app.
--   display_name  free text, trimmed, up to 60 chars.
--   avatar_key    lookup key into the client-side avatar registry
--                 (src/lib/mtg/avatars.ts). Values like 'gem-arcane',
--                 'card-red', 'google' (for the visitor's OAuth image).
--   created_at    row create.
--   updated_at    last save. Trigger updates it on UPDATE.
--
-- RLS:
--   authenticated users can SELECT / INSERT / UPDATE / DELETE their own
--   row only. Service role bypasses.

CREATE TABLE IF NOT EXISTS public.mtg_user_profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL DEFAULT '' CHECK (char_length(display_name) <= 60),
  avatar_key    text NOT NULL DEFAULT 'gem-arcane' CHECK (char_length(avatar_key) <= 40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Trigger: bump updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.mtg_user_profiles_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mtg_user_profiles_updated ON public.mtg_user_profiles;
CREATE TRIGGER mtg_user_profiles_updated
BEFORE UPDATE ON public.mtg_user_profiles
FOR EACH ROW EXECUTE FUNCTION public.mtg_user_profiles_touch();

ALTER TABLE public.mtg_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mtg_user_profiles_select_own ON public.mtg_user_profiles;
CREATE POLICY mtg_user_profiles_select_own ON public.mtg_user_profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mtg_user_profiles_insert_own ON public.mtg_user_profiles;
CREATE POLICY mtg_user_profiles_insert_own ON public.mtg_user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mtg_user_profiles_update_own ON public.mtg_user_profiles;
CREATE POLICY mtg_user_profiles_update_own ON public.mtg_user_profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mtg_user_profiles_delete_own ON public.mtg_user_profiles;
CREATE POLICY mtg_user_profiles_delete_own ON public.mtg_user_profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mtg_user_profiles TO authenticated;
GRANT ALL ON public.mtg_user_profiles TO service_role;
