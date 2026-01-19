-- Remove Team from Draft Migration
-- Allows commissioners to remove teams from their league's draft

-- Function to remove a team from the draft
-- Only commissioners can remove teams, and only before the draft has started
CREATE OR REPLACE FUNCTION public.remove_team_from_draft(p_team_id UUID)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID;
  v_league_id UUID;
  v_team_name TEXT;
  v_draft_status TEXT;
BEGIN
  -- Get current user ID from auth context
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Get the team's league and name
  SELECT t.league_id, t.name INTO v_league_id, v_team_name
  FROM public.teams t
  WHERE t.id = p_team_id;
  
  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;
  
  -- Verify user is commissioner of the league
  IF NOT EXISTS (
    SELECT 1 FROM public.leagues 
    WHERE id = v_league_id AND commissioner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only the league commissioner can remove teams';
  END IF;
  
  -- Check if draft has already started
  SELECT draft_status INTO v_draft_status
  FROM public.leagues
  WHERE id = v_league_id;
  
  IF v_draft_status = 'in_progress' THEN
    RAISE EXCEPTION 'Cannot remove teams while draft is in progress';
  END IF;
  
  IF v_draft_status = 'completed' THEN
    RAISE EXCEPTION 'Cannot remove teams after draft is completed';
  END IF;
  
  -- Remove the team from draft_order if present in draft_state
  UPDATE public.draft_state
  SET draft_order = array_remove(draft_order, v_team_name)
  WHERE id = 1;
  
  -- Delete the team (this will cascade to delete related records like rosters, draft_picks)
  DELETE FROM public.teams WHERE id = p_team_id;
  
  -- Update league team count
  UPDATE public.leagues
  SET current_teams = GREATEST(current_teams - 1, 0)
  WHERE id = v_league_id;
  
  RETURN json_build_object(
    'message', 'Team removed from draft',
    'team_id', p_team_id,
    'team_name', v_team_name,
    'league_id', v_league_id
  );
END;
$$ LANGUAGE plpgsql;

-- Add RLS policy for commissioners to delete teams
-- First drop if exists to avoid conflicts
DROP POLICY IF EXISTS "Commissioners can delete teams from their leagues" ON public.teams;

CREATE POLICY "Commissioners can delete teams from their leagues"
  ON public.teams FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.leagues
      WHERE leagues.id = teams.league_id
      AND leagues.commissioner_id = auth.uid()
    )
  );
