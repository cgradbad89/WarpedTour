# CLAUDE.md — Warped Tour Long Beach 2026 Band Explorer

## Workflow Rules

- **Branch**: Work directly on `main`. If a branch is created automatically, merge it into `main` before pushing.
- **Build**: Run `npm run build` after all changes. On failure, fix and retry. Stop after 3 consecutive failures — output the full error log and make no further changes.
- **Test**: Run `npm test` after a passing build. (No test baseline yet — this is a new project. When you add the first tests, record the count here.)
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
| App type | Static Next.js, no backend, no auth, single user |
| Data layer | `public/bands.json` (read-only at runtime) |
| Personal state | Browser localStorage only — key `warped2026:status` |
| Cross-device sync | None (intentional MVP scope) |
| Backend / DB | None — no Firebase, no Firestore |
| Runtime external calls | None — app is fully static |
| Data-refresh sources | Deezer + MusicBrainz, both keyless |
| Env vars / API keys | None. If multi-user is ever built, Spotify OAuth secrets are server-only — never `NEXT_PUBLIC_*` |
| Spotify links | Search URLs (`spotify:search:`), not artist-ID deep links — see PRD §6 |
| Deploy target | Vercel |
| Local repo | _(set on first commit)_ |

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
    page.tsx        # Main list/explorer view ("/")
    band/           # Detail route OR detail modal lives near the list view
  components/       # BandRow, BandDetail, PreviewPlayer, filters, StatusToggle
  lib/
    storage.ts      # localStorage read/write for warped2026:status
    bands.ts        # Load + type bands.json
  types/            # Band + dataset TypeScript interfaces (mirror bands.json)
```

**See also**: `PRD.md` — full product reference (data contract, UI requirements, sharp edges, backlog, data pipeline).
