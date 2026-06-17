"use client";

import { useState } from "react";
import type { TasteProfile } from "@/lib/scoring";
import { UploadProfileModal } from "./UploadProfileModal";

// Header bar showing WHOSE taste is driving the scores, with the upload entry
// point (PRD §10). With no profile it doubles as the first-visit prompt ("Scores:
// default · Upload yours"). With a profile it shows "your upload" + Replace /
// Clear. Clearing returns to the owner's default view and never touches picks.

export function ProfileBar({
  profile,
  onSetProfile,
  onClearProfile,
}: {
  profile: TasteProfile | null;
  onSetProfile: (profile: TasteProfile) => void;
  onClearProfile: () => void;
}) {
  const [open, setOpen] = useState(false);

  const smallBtn =
    "inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-3 text-sm font-semibold ring-1 ring-inset transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pb-2">
      {profile ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-1 text-xs font-bold text-accent ring-1 ring-inset ring-accent/30">
            <span aria-hidden="true">★</span> Your upload
          </span>
          {profile.label && (
            <span
              className="max-w-[40%] truncate text-xs text-muted-foreground"
              title={profile.label}
            >
              {profile.label}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`${smallBtn} text-muted-foreground ring-border hover:bg-muted`}
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onClearProfile}
              className={`${smallBtn} text-muted-foreground ring-border hover:bg-muted`}
            >
              Use default
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-sm text-muted-foreground">
            Scores: <span className="font-semibold text-foreground">default</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`${smallBtn} ml-auto bg-accent text-accent-foreground ring-accent hover:opacity-90`}
          >
            Upload taste
          </button>
        </>
      )}

      {open && (
        <UploadProfileModal
          onLoaded={(p) => {
            onSetProfile(p);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
