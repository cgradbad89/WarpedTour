"use client";

import type { Band, BandStatus } from "@/types";
import { Avatar } from "./Avatar";
import { Stars } from "./Stars";
import { ScoreChip } from "./ScoreChip";
import { StatusBadge } from "./StatusBadge";

// A single tappable list row (PRD §5.1): avatar, name, genres, stars, score
// chip, and the saved status marker if any. Spans (not divs) keep the markup
// valid phrasing content inside the <button>.

export function BandRow({
  band,
  status,
  onOpen,
}: {
  band: Band;
  status: BandStatus | undefined;
  onOpen: (band: Band) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(band)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted active:bg-muted"
    >
      <Avatar name={band.name} image={band.image} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{band.name}</span>
          {status && <StatusBadge status={status} />}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <Stars score={band.score} />
          <span className="truncate text-xs text-muted-foreground">
            {band.genres.join(" · ")}
          </span>
        </span>
      </span>
      <ScoreChip score={band.score} bucket={band.bucket} />
    </button>
  );
}
