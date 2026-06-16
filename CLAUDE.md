# CLAUDE.md — Warped Tour Long Beach 2026 Band Explorer

## Workflow Rules

- **Branch**: Work directly on `main`. If a branch is created automatically, merge it into `main` before pushing.
- **Build**: Run `npm run build` after all changes. On failure, fix and retry. Stop after 3 consecutive failures — output the full error log and make no further changes.
- **Test**: Run `npm test` after a passing build. Baseline: **27 tests** (`node --test` over `tests/`, dependency-free, Node ≥ 22 native TS — covers the CSV tokenizer, taste-CSV parser, and the `scoring.ts` re-score port). Update this count when you add/remove tests.
- **Commit**: Stage files by explicit path (`git add PRD.md public/bands.json src/...`). Never use `git add -A`. Commit and push only after build (and any tests) pass.
- **No broken commits**: Do not commit if `npm run build` or `npm test` fail.

## Data File Rules

- **`public/bands.json` is the canonical, read-only data layer.** The app reads it; the app never writes it.
- **Do not regenerate `bands.json` as part of app/UI work.** It is regenerated only by `scripts/refresh-data.*`, and only when a task explicitly authorizes it (e.g. new bands announced, updated Spotify export).
- The `user_status` field inside `bands.json` is a frozen `null`. **Ignore it.** All personal state lives in localStorage (key `warped2026:status`).
- If you change the band object shape, update **both** the refresh script and PRD.md Section 3 in the same commit.

## Refreshing the Data

- `scripts/refresh-data.*` rebuilds `public/bands.json` from `scripts/lineup.txt` (band names) and `scripts/taste_multi.json` (my 3-window Spotify export).
- All data sources are **keyless** — no API keys, no env vars. Deezer (`api.deezer.com`) for similar artists / top track / preview / image / fans; MusicBrainz (`musicbrainz.org/ws/2`) for genre tags + origin.
- **MusicBrainz rate limit: ≤1 request/second**, and a descriptive `User-Agent` header is required. Do not parallelize MusicBrainz calls.
- Editing `lineup.txt` or `taste_multi.json` does nothing until the script is run and the regenerated `bands.json` is committed. Refreshes are manual and only happen when a task explicitly authorizes them.
- After a refresh, sanity-check before committing: band count is plausible, ~all bands have a `preview_url`, and the score distribution is not entirely `1.0` (all-1.0 means the taste export failed to parse).

## PRD Maintenance

After every session, update `PRD.md` if any of the following changed:

- New route or page added → Section 2 (Page Inventory)
- Band object shape or `bands.json` top-level shape changed → Section 3 (Data Model)
- localStorage key or personal-state behavior changed → Section 4
- A scoring/data-pipeline rule changed → Section 8
- New sharp edge or gotcha found → Section 6 (Known Sharp Edges)
- Backlog item completed or discovered → Section 7 (Feature Backlog)

Do **not** update PRD.md for bug fixes or UI-only changes unless they affect architecture or the data contract.
Commit PRD.md in the same commit as the feature work.

## Required Output Report

End every session with this exact format:

```
Files modified:   [path — one-line reason each]
Files created:    [path — one-line reason each]
Tests:            [new count] new / [total] total  (or "none yet")
Build:            PASSED or FAILED (paste error if failed)
Deployment:       committed and pushed to main — yes / no
PRD.md updated:   yes — [sections changed] / no — [reason]
Data refreshed:   yes — [why, + new band/preview counts] / no
Unverifiable:     [items that can't be confirmed from code alone, or "none"]
Deferred:         [anything not completed, or "none"]
```

## Key Constraints

| Item | Value |
|---|---|
| App type | Next.js — static except one tiny keyless API route (`/api/preview`); no auth |
| Data layer | `public/bands.json` (read-only at runtime) |
| Personal state | Browser localStorage only — keys `warped2026:status` (picks) + `warped2026:order` (My-Picks order) |
| Uploaded taste | `warped2026:profile` — a friend's parsed taste for the client-side re-score (PRD §10). Separate from picks; never written to `bands.json`; absent ⇒ owner's default view |
| Re-score algorithm | **`src/lib/scoring.ts` is the single source of the runtime algorithm** — a faithful port of `scripts/refresh-data.mjs`. Change one, mirror the other (+ its tests). PRD §10 |
| Cross-device sync | None (intentional MVP scope) |
| Backend / DB | No DB. One keyless route — `GET /api/preview?id=<deezer_id>` resolves fresh Deezer preview URLs (no secrets, no env). PRD §5.2/§6/§8.4 |
| Runtime external calls | One: `/api/preview` → Deezer (server-side), because stored `preview_url`s are signed links that expire daily and Deezer has no browser CORS. Re-score (§10) is pure client-side; nothing else hits the network |
| Data-refresh sources | Deezer + MusicBrainz, both keyless |
| Env vars / API keys | None. If multi-user is ever built, Spotify OAuth secrets are server-only — never `NEXT_PUBLIC_*` |
| Spotify links | Search URLs (`spotify:search:`), not artist-ID deep links — see PRD §6 |
| Deploy target | Vercel |
| Local repo | https://github.com/cgradbad89/WarpedTour |

## Architecture Quick Reference

```
public/
  bands.json        # Canonical data layer (read-only at runtime)
scripts/
  refresh-data.*    # Rebuilds bands.json from lineup + taste export
  lineup.txt        # Band names, one per line (edit when bands announced)
  taste_multi.json  # My 3-window Spotify export (lifetime / 6mo / 1mo)
src/
  app/
    page.tsx        # Main list/explorer view ("/") — list, filters, "show only my picks"
    picks/page.tsx  # "My Picks" view ("/picks") — status sections, reorder (drag + arrows)
    api/preview/route.ts  # GET ?id=<deezer_id> → fresh 30s preview URL (stored ones expire; Deezer has no CORS)
  components/       # BandRow, BandDetail, PreviewPlayer, Controls, StatusToggle, Nav, PicksSection,
                    # ProfileBar, UploadProfileModal  (detail is an in-page modal, not a route)
  lib/
    storage.ts      # localStorage read/write for warped2026:status + warped2026:order
    personal.ts     # usePersonalState hook (status + order; shared by both pages)
    bands.ts        # Load + type bands.json
    preview.ts      # resolvePreview(deezer_id) — fetch a fresh preview URL via /api/preview (session-cached)
    scoring.ts      # SINGLE SOURCE of the re-score algorithm (port of refresh-data.mjs) + TasteProfile
    tasteCsv.ts     # Parse an uploaded Spotify taste CSV → TasteProfile (defensive)
    csv.ts          # RFC-4180 CSV tokenizer (dependency-free)
    profile.ts      # warped2026:profile storage + useProfile / useExplorerData (re-score seam)
  types/            # Band + dataset TypeScript interfaces (mirror bands.json)
tests/              # node --test suites (csv / tasteCsv / scoring) + TS resolution hook
```

**See also**: `PRD.md` — full product reference (data contract, UI requirements, sharp edges, backlog, data pipeline; the upload/re-score feature is **§10**).
