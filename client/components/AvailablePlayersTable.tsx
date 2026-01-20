import { useRef, useState, useMemo, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Player {
  id: string;
  name: string;
  position?: string;
}

interface AvailablePlayersTableProps {
  players: Player[];
  onDraft: (playerId: string, playerName: string) => void;
  disabled?: boolean;
  isMyTurn?: boolean;
}

// Row height for virtualization
const ROW_HEIGHT = 48;
// Container height for the scrollable area
const CONTAINER_HEIGHT = 450;
// Debounce delay for search input
const SEARCH_DEBOUNCE_MS = 300;

// MLB position categories
const PITCHER_POSITIONS = new Set(["P", "SP", "RP"]);
type PlayerCategory = "all" | "batters" | "pitchers";

export function AvailablePlayersTable({
  players,
  onDraft,
  disabled = false,
  isMyTurn = false,
}: AvailablePlayersTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PlayerCategory>("all");
  const [positionFilter, setPositionFilter] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Extract unique positions from players, filtered by category
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    players.forEach((p) => {
      if (p.position) {
        const isPitcher = PITCHER_POSITIONS.has(p.position);
        // Only include positions that match the current category filter
        if (
          categoryFilter === "all" ||
          (categoryFilter === "pitchers" && isPitcher) ||
          (categoryFilter === "batters" && !isPitcher)
        ) {
          posSet.add(p.position);
        }
      }
    });
    return Array.from(posSet).sort();
  }, [players, categoryFilter]);

  // Filter players based on search, category, and position
  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      const matchesSearch = p.name
        .toLowerCase()
        .includes(debouncedSearch.toLowerCase());
      
      // Category filter (Batters vs Pitchers)
      const isPitcher = p.position ? PITCHER_POSITIONS.has(p.position) : false;
      const matchesCategory =
        categoryFilter === "all" ||
        (categoryFilter === "pitchers" && isPitcher) ||
        (categoryFilter === "batters" && !isPitcher);
      
      // Specific position filter
      const matchesPosition =
        !positionFilter || p.position === positionFilter;
      
      return matchesSearch && matchesCategory && matchesPosition;
    });
  }, [players, debouncedSearch, categoryFilter, positionFilter]);

  // Set up virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredPlayers.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5, // Render 5 extra items above/below visible area for smoother scrolling
  });

  const clearFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setCategoryFilter("all");
    setPositionFilter(null);
  };

  // Reset position filter when category changes (since positions are category-specific)
  const handleCategoryChange = (category: PlayerCategory) => {
    setCategoryFilter(category);
    setPositionFilter(null); // Reset specific position when category changes
  };

  const hasFilters = searchInput || categoryFilter !== "all" || positionFilter;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Available Players</CardTitle>
        <CardDescription>
          {filteredPlayers.length === players.length
            ? `${players.length} players remaining`
            : `${filteredPlayers.length} of ${players.length} players shown`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search and Filter Controls */}
        <div className="space-y-3 mb-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search players by name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput("");
                  setDebouncedSearch("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category Filter (Batters / Pitchers) */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={categoryFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryChange("all")}
            >
              All
            </Button>
            <Button
              variant={categoryFilter === "batters" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryChange("batters")}
            >
              Batters
            </Button>
            <Button
              variant={categoryFilter === "pitchers" ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryChange("pitchers")}
            >
              Pitchers
            </Button>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="text-gray-500 ml-2"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Position Filter Buttons */}
          {positions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant={positionFilter === null ? "secondary" : "outline"}
                size="sm"
                onClick={() => setPositionFilter(null)}
              >
                All {categoryFilter === "batters" ? "Batters" : categoryFilter === "pitchers" ? "Pitchers" : "Positions"}
              </Button>
              {positions.map((pos) => (
                <Button
                  key={pos}
                  variant={positionFilter === pos ? "secondary" : "outline"}
                  size="sm"
                  onClick={() =>
                    setPositionFilter(positionFilter === pos ? null : pos)
                  }
                >
                  {pos}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Table Header */}
        <div className="border-b">
          <div className="flex items-center py-2 px-2 text-sm font-medium text-gray-600">
            <div className="flex-1 min-w-0">Player</div>
            <div className="w-20 text-center">Position</div>
            <div className="w-16 text-center">Stats</div>
            <div className="w-20 text-right">Action</div>
          </div>
        </div>

        {/* Virtualized Table Body */}
        <div
          ref={parentRef}
          className="overflow-auto"
          style={{ height: CONTAINER_HEIGHT }}
        >
          {filteredPlayers.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-500">
              {players.length === 0
                ? "No players available"
                : "No players match your filters"}
            </div>
          ) : (
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const player = filteredPlayers[virtualRow.index];
                return (
                  <div
                    key={player.id}
                    className={cn(
                      "absolute top-0 left-0 w-full flex items-center px-2 border-b hover:bg-gray-50",
                      virtualRow.index % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    )}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="flex-1 min-w-0 truncate">
                      <span className="font-medium">{player.name}</span>
                    </div>
                    <div className="w-20 text-center">
                      {player.position && (
                        <Badge variant="secondary" className="text-xs">
                          {player.position}
                        </Badge>
                      )}
                    </div>
                    <div className="w-16 text-center text-sm text-gray-500">
                      —
                    </div>
                    <div className="w-20 text-right">
                      <Button
                        size="sm"
                        onClick={() => onDraft(player.id, player.name)}
                        disabled={disabled || !isMyTurn}
                      >
                        Draft
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info */}
        {filteredPlayers.length > 0 && (
          <div className="pt-3 border-t mt-2 text-xs text-gray-500 text-center">
            Showing {Math.min(Math.ceil(CONTAINER_HEIGHT / ROW_HEIGHT), filteredPlayers.length)} of{" "}
            {filteredPlayers.length} players • Scroll to see more
          </div>
        )}
      </CardContent>
    </Card>
  );
}
