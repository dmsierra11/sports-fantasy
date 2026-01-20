/**
 * MLB Player Seed Script
 *
 * Fetches real MLB player data from the official MLB Stats API
 * and populates the database.
 *
 * Usage:
 *   npx tsx scripts/seed-mlb-players.ts
 *
 * Environment variables required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (not anon key) for admin access
 */

import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

// ============================================================================
// Configuration
// ============================================================================

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Error: Missing Supabase credentials");
  console.error("Required environment variables:");
  console.error("  - SUPABASE_URL or VITE_SUPABASE_URL");
  console.error("  - SUPABASE_SERVICE_ROLE_KEY (recommended) or VITE_SUPABASE_ANON_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// MLB Stats API base URL (free, no API key required)
const MLB_API_BASE = "https://statsapi.mlb.com/api/v1";

// Current season
const SEASON = new Date().getFullYear();

// ============================================================================
// Types
// ============================================================================

interface MLBTeam {
  id: number;
  name: string;
  abbreviation: string;
  teamName: string;
  locationName: string;
}

interface MLBPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
  primaryNumber?: string;
  primaryPosition: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
  batSide?: { code: string; description: string };
  pitchHand?: { code: string; description: string };
  currentTeam?: { id: number };
}

interface PlayerInsert {
  external_id: string;
  first_name: string;
  last_name: string;
  position: string;
  pro_team: string;
  jersey_number: number | null;
  sport: string;
  stats: Record<string, unknown>;
  is_available: boolean;
}

// ============================================================================
// MLB API Functions
// ============================================================================

async function fetchMLBTeams(): Promise<MLBTeam[]> {
  console.log("Fetching MLB teams...");

  const response = await fetch(`${MLB_API_BASE}/teams?sportId=1&season=${SEASON}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch teams: ${response.statusText}`);
  }

  const data = await response.json();
  return data.teams || [];
}

interface RosterEntry {
  person: MLBPlayer;
  jerseyNumber?: string;
  position?: {
    code: string;
    name: string;
    type: string;
    abbreviation: string;
  };
}

async function fetchTeamRoster(teamId: number, teamAbbreviation: string): Promise<PlayerInsert[]> {
  const response = await fetch(
    `${MLB_API_BASE}/teams/${teamId}/roster?rosterType=fullRoster&season=${SEASON}`
  );

  if (!response.ok) {
    console.warn(`Failed to fetch roster for team ${teamId}: ${response.statusText}`);
    return [];
  }

  const data = await response.json();
  const roster: RosterEntry[] = data.roster || [];

  return roster.map((entry) => {
    const player = entry.person;
    // Position is on the roster entry, not inside person
    const position = normalizePosition(entry.position?.abbreviation || "UT");

    return {
      external_id: `mlb_${player.id}`,
      first_name: player.firstName || player.fullName.split(" ")[0],
      last_name: player.lastName || player.fullName.split(" ").slice(1).join(" "),
      position,
      pro_team: teamAbbreviation,
      jersey_number: entry.jerseyNumber ? parseInt(entry.jerseyNumber, 10) : null,
      sport: "MLB",
      stats: {
        mlb_id: player.id,
        bat_side: player.batSide?.code,
        pitch_hand: player.pitchHand?.code,
        position_type: entry.position?.type,
      },
      is_available: true,
    };
  });
}

/**
 * Normalize MLB position abbreviations to standard fantasy positions
 */
function normalizePosition(position: string): string {
  const positionMap: Record<string, string> = {
    // Standard positions
    P: "P",
    C: "C",
    "1B": "1B",
    "2B": "2B",
    "3B": "3B",
    SS: "SS",
    LF: "LF",
    CF: "CF",
    RF: "RF",
    DH: "DH",
    // Alternate abbreviations
    SP: "SP", // Starting Pitcher
    RP: "RP", // Relief Pitcher
    CL: "CL", // Closer
    OF: "OF", // Outfield (generic)
    IF: "IF", // Infield (generic)
    TWP: "P", // Two-way player
    // Utility
    UT: "UT",
    PH: "UT", // Pinch Hitter
    PR: "UT", // Pinch Runner
  };

  return positionMap[position] || position;
}

// ============================================================================
// Database Functions
// ============================================================================

async function clearExistingMLBPlayers(): Promise<void> {
  console.log("Clearing existing MLB players...");

  // Use RPC to delete related records via raw SQL for reliability
  // This handles the foreign key constraints properly
  const { error: clearError } = await supabase.rpc("clear_mlb_players_for_reseed");

  if (clearError) {
    // If RPC doesn't exist, fall back to manual deletion
    console.log("RPC not available, using manual cleanup...");

    // Get all MLB player IDs in batches
    const { data: mlbPlayers, error: fetchError } = await supabase
      .from("players")
      .select("id")
      .eq("sport", "MLB");

    if (fetchError) {
      throw new Error(`Failed to fetch existing players: ${fetchError.message}`);
    }

    if (mlbPlayers && mlbPlayers.length > 0) {
      const playerIds = mlbPlayers.map((p) => p.id);

      // Delete in smaller batches to avoid "Bad Request"
      const BATCH_SIZE = 50;

      for (let i = 0; i < playerIds.length; i += BATCH_SIZE) {
        const batch = playerIds.slice(i, i + BATCH_SIZE);

        // Delete related mock_draft_picks
        await supabase.from("mock_draft_picks").delete().in("player_id", batch);

        // Delete related draft_picks
        await supabase.from("draft_picks").delete().in("player_id", batch);

        // Delete related rosters
        await supabase.from("rosters").delete().in("player_id", batch);
      }
    }

    // Now delete the players
    const { error } = await supabase.from("players").delete().eq("sport", "MLB");

    if (error) {
      throw new Error(`Failed to clear existing players: ${error.message}`);
    }
  }

  console.log("Cleared existing MLB players and related records.");
}

async function insertPlayers(players: PlayerInsert[]): Promise<number> {
  if (players.length === 0) return 0;

  // Insert in batches of 100 to avoid timeouts
  const BATCH_SIZE = 100;
  let insertedCount = 0;

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);

    const { error } = await supabase.from("players").upsert(batch, {
      onConflict: "external_id",
      ignoreDuplicates: false,
    });

    if (error) {
      console.error(`Failed to insert batch ${i / BATCH_SIZE + 1}:`, error.message);
    } else {
      insertedCount += batch.length;
    }
  }

  return insertedCount;
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("MLB Player Seed Script");
  console.log(`Season: ${SEASON}`);
  console.log("=".repeat(60));
  console.log();

  try {
    // Step 1: Clear existing MLB players
    await clearExistingMLBPlayers();

    // Step 2: Fetch all MLB teams
    const teams = await fetchMLBTeams();
    console.log(`Found ${teams.length} MLB teams\n`);

    // Step 3: Fetch rosters for each team
    const allPlayers: PlayerInsert[] = [];

    for (const team of teams) {
      process.stdout.write(`Fetching ${team.abbreviation} (${team.teamName})... `);

      const players = await fetchTeamRoster(team.id, team.abbreviation);
      allPlayers.push(...players);

      console.log(`${players.length} players`);

      // Small delay to be nice to the API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log();
    console.log(`Total players fetched: ${allPlayers.length}`);
    console.log();

    // Step 4: Insert into database
    console.log("Inserting players into database...");
    const insertedCount = await insertPlayers(allPlayers);

    console.log();
    console.log("=".repeat(60));
    console.log(`Successfully seeded ${insertedCount} MLB players!`);
    console.log("=".repeat(60));

    // Step 5: Show summary by position
    const positionCounts: Record<string, number> = {};
    for (const player of allPlayers) {
      positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    }

    console.log("\nPlayers by position:");
    Object.entries(positionCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([pos, count]) => {
        console.log(`  ${pos}: ${count}`);
      });
  } catch (error) {
    console.error("Error seeding players:", error);
    process.exit(1);
  }
}

main();
