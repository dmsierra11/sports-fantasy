-- Migration: Sports-Agnostic Schema
-- Makes the schema flexible for multiple sports (MLB, NFL, NBA, etc.)
-- Primary focus: MLB (Baseball)

-- ============================================================================
-- 1. ADD SPORT COLUMN TO LEAGUES
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'leagues' 
    AND column_name = 'sport'
  ) THEN
    ALTER TABLE public.leagues ADD COLUMN sport TEXT DEFAULT 'MLB' NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. ADD SPORT COLUMN TO PLAYERS
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'players' 
    AND column_name = 'sport'
  ) THEN
    ALTER TABLE public.players ADD COLUMN sport TEXT DEFAULT 'MLB' NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. RENAME 'team' TO 'pro_team' FOR CLARITY
-- ============================================================================
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'players' 
    AND column_name = 'team'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'players' 
    AND column_name = 'pro_team'
  ) THEN
    ALTER TABLE public.players RENAME COLUMN team TO pro_team;
  END IF;
END $$;

-- ============================================================================
-- 4. REMOVE NFL-SPECIFIC POSITION CONSTRAINT
-- ============================================================================
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Find and drop the constraint on position column
  SELECT con.conname INTO constraint_name
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'players'
    AND nsp.nspname = 'public'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%position%';
  
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.players DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped position constraint: %', constraint_name;
  END IF;
END $$;

-- ============================================================================
-- 5. ADD INDEXES FOR SPORT FILTERING
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_leagues_sport ON public.leagues(sport);
CREATE INDEX IF NOT EXISTS idx_players_sport ON public.players(sport);
CREATE INDEX IF NOT EXISTS idx_players_sport_position ON public.players(sport, position);
CREATE INDEX IF NOT EXISTS idx_players_sport_pro_team ON public.players(sport, pro_team);

-- ============================================================================
-- 6. CLEAR EXISTING PLACEHOLDER PLAYERS AND RELATED DATA
-- ============================================================================
-- First, delete mock draft picks that reference placeholder players
DELETE FROM public.mock_draft_picks 
WHERE player_id IN (
  SELECT id FROM public.players 
  WHERE first_name = 'Player' AND last_name ~ '^[0-9]+$'
);

-- Delete draft picks that reference placeholder players
DELETE FROM public.draft_picks 
WHERE player_id IN (
  SELECT id FROM public.players 
  WHERE first_name = 'Player' AND last_name ~ '^[0-9]+$'
);

-- Delete roster entries that reference placeholder players
DELETE FROM public.rosters 
WHERE player_id IN (
  SELECT id FROM public.players 
  WHERE first_name = 'Player' AND last_name ~ '^[0-9]+$'
);

-- Now remove the auto-generated "Player 1", "Player 2", etc. placeholder players
DELETE FROM public.players WHERE first_name = 'Player' AND last_name ~ '^[0-9]+$';

-- ============================================================================
-- 7. UPDATE init_draft_players TO BE SPORTS-AWARE (deprecated - use seed script)
-- ============================================================================
-- This function is deprecated. Use the seed-mlb-players.ts script instead
-- to populate real player data from the MLB Stats API.
DROP FUNCTION IF EXISTS public.init_draft_players();

-- ============================================================================
-- 8. HELPER FUNCTION: GET VALID POSITIONS FOR A SPORT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_valid_positions(p_sport TEXT)
RETURNS TEXT[] AS $$
BEGIN
  CASE p_sport
    WHEN 'MLB' THEN
      RETURN ARRAY['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'OF', 'IF', 'UT', 'SP', 'RP', 'CL'];
    WHEN 'NFL' THEN
      RETURN ARRAY['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB', 'DB', 'DL'];
    WHEN 'NBA' THEN
      RETURN ARRAY['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UT'];
    WHEN 'NHL' THEN
      RETURN ARRAY['C', 'LW', 'RW', 'D', 'G', 'F', 'UT'];
    ELSE
      RETURN ARRAY[]::TEXT[];
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 9. HELPER FUNCTION: VALIDATE PLAYER POSITION FOR SPORT
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_player_position()
RETURNS TRIGGER AS $$
DECLARE
  valid_positions TEXT[];
BEGIN
  valid_positions := public.get_valid_positions(NEW.sport);
  
  -- If we have valid positions defined for this sport, validate
  IF array_length(valid_positions, 1) > 0 THEN
    IF NOT (NEW.position = ANY(valid_positions)) THEN
      RAISE WARNING 'Position % may not be standard for sport %. Valid positions: %', 
        NEW.position, NEW.sport, valid_positions;
      -- Note: We use WARNING instead of EXCEPTION to allow flexibility
      -- Some leagues may use custom positions
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for position validation (warnings only, non-blocking)
DROP TRIGGER IF EXISTS validate_player_position_trigger ON public.players;
CREATE TRIGGER validate_player_position_trigger
  BEFORE INSERT OR UPDATE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_player_position();

-- ============================================================================
-- 10. ADD COMMENT DOCUMENTATION
-- ============================================================================
COMMENT ON COLUMN public.leagues.sport IS 'Sport type: MLB, NFL, NBA, NHL, etc.';
COMMENT ON COLUMN public.players.sport IS 'Sport type: MLB, NFL, NBA, NHL, etc.';
COMMENT ON COLUMN public.players.pro_team IS 'Professional team abbreviation (e.g., NYY, LAD for MLB)';
COMMENT ON COLUMN public.players.position IS 'Player position, varies by sport (e.g., SS, P for MLB; QB, WR for NFL)';
COMMENT ON FUNCTION public.get_valid_positions(TEXT) IS 'Returns array of valid positions for a given sport';

-- ============================================================================
-- 11. RPC FUNCTION TO CLEAR PLAYERS FOR RE-SEEDING
-- ============================================================================
-- This function runs with SECURITY DEFINER to bypass RLS
-- IMPORTANT: Only callable with service_role key (not anon key)
CREATE OR REPLACE FUNCTION public.clear_mlb_players_for_reseed()
RETURNS void AS $$
BEGIN
  -- Security check: Only allow service_role or authenticated admins
  -- The service_role key sets request.jwt.claim.role to 'service_role'
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'This function can only be called with service_role key';
  END IF;

  -- Delete mock draft picks referencing MLB players
  DELETE FROM public.mock_draft_picks 
  WHERE player_id IN (SELECT id FROM public.players WHERE sport = 'MLB');

  -- Delete draft picks referencing MLB players  
  DELETE FROM public.draft_picks 
  WHERE player_id IN (SELECT id FROM public.players WHERE sport = 'MLB');

  -- Delete roster entries referencing MLB players
  DELETE FROM public.rosters 
  WHERE player_id IN (SELECT id FROM public.players WHERE sport = 'MLB');

  -- Delete the MLB players
  DELETE FROM public.players WHERE sport = 'MLB';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
