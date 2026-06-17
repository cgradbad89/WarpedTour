# CLAUDE.md — Warped Tour Long Beach 2026 Band Explorer

## Workflow Rules

- **Branch**: Work directly on `main`. If a branch is created automatically, merge it into `main` before pushing.
- **Build**: Run `npm run build` after all changes. On failure, fix and retry. Stop after 3 consecutive failures — output the full error log and make no further changes.
- **Test**: Run `npm test` after a passing build. Baseline: **36 tests** (`node --test` over `tests/`, dependency-free, Node ≥ 22 native TS — covers the CSV tokenizer, taste-CSV parser, the `scoring.ts` re-score port, and the `merge.ts` cloud-sync merge/coerce). Update this count when you add/remove tests.
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
| App type | Next.js — static pages + one keyless API route (`/api/preview`). **Optional** Google auth + Firestore cloud sync (client-only); logged out = no backend, exactly as before. PRD §12 |
| Data layer | `public/bands.json` (read-only at runtime). NOT in Firestore — only the user's personal state syncs |
| Personal state | Browser localStorage by default — keys `warped2026:status` (picks) + `warped2026:order` (My-Picks order) + `warped2026:profile` (uploaded taste). **Optionally** syncs to Firestore when signed in (PRD §12); logged out is localStorage-only and unchanged |
| Uploaded taste | `warped2026:profile` — a friend's parsed taste for the client-side re-score (PRD §10). Separate from picks; never written to `bands.json`; absent ⇒ owner's default view. Syncs as its own field in the per-user doc when signed in |
| Re-score algorithm | **`src/lib/scoring.ts` is the single source of the runtime algorithm** — a faithful port of `scripts/refresh-data.mjs`. Change one, mirror the other (+ its tests). PRD §10 |
| Storage seam | **`src/lib/personalStore.tsx` owns `{status,order,profile}` and switches localStorage↔Firestore by auth.** `usePersonalState`/`useProfile` are thin readers over it — don't break those contracts. Login merge is pure in `src/lib/merge.ts`. PRD §12 |
| Cross-device sync | **Optional** — Google sign-in + Firestore per-user doc (PRD §12). Off by default (logged out = localStorage only) |
| Backend / DB | No DB for band data (`bands.json` read-only, NOT in Firestore). Backends: keyless `/api/preview` route; **optional** Firestore for signed-in personal state only, namespaced to `warped_users/{uid}` in the **shared `wdnnsp`** project. PRD §5.2/§6/§8.4/§12 |
| Firebase / Firestore | Shared `wdnnsp` project (hosts another app — **do not break it**). This app touches ONLY `warped_users/{uid}`; never the root or other collections. Security rules are **append-only** (scoped to that path) and live in `firestore.rules` — output for **manual** deploy, never auto-deployed; never replace/broaden the project's existing rules |
| Runtime external calls | `/api/preview` → Deezer (server-side; stored `preview_url`s expire and Deezer has no browser CORS); **optional** Firebase Auth + Firestore when signed in (client-side). Re-score (§10) is pure client-side; logged out, nothing but `/api/preview` hits the network |
| Data-refresh sources | Deezer + MusicBrainz, both keyless |
| Env vars / API keys | App/refresh: none. **Firebase web config:** `NEXT_PUBLIC_FIREBASE_*` (API_KEY, AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID, APP_ID) in `.env.local` (gitignored) + Vercel. **Public by design** — the web SDK config ships to the browser and is gated by security rules, not secrecy, so the `ANTHROPIC_API_KEY`-style secrecy rule does NOT apply. Never hardcode them in source (read from `process.env`). A hypothetical future Spotify OAuth secret would still be server-only — never `NEXT_PUBLIC_*` |
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
firestore.rules    # Firestore security rules — OUTPUT ONLY, append-scoped to warped_users/{uid}; deploy MANUALLY, never replace shared-project rules (PRD §12.5)
.env.local         # NEXT_PUBLIC_FIREBASE_* (gitignored; mirrored in Vercel) — never committed
src/
  app/
    layout.tsx      # Wraps app in <AuthProvider> + <PersonalStoreProvider> (SSR-safe; degrades to logged-out)
    page.tsx        # Main list/explorer view ("/") — list, filters, "show only my picks"
    picks/page.tsx  # "My Picks" view ("/picks") — status sections, reorder (drag + arrows)
    schedule/page.tsx  # "Schedule" view ("/schedule") — PREDICTED day/stage/time grid + must-see conflicts (PRD §11)
    api/preview/route.ts  # GET ?id=<deezer_id> → fresh 30s preview URL (stored ones expire; Deezer has no CORS)
  components/       # BandRow, BandDetail, PreviewPlayer, Controls, StatusToggle, Nav, PicksSection,
                    # ProfileBar, UploadProfileModal, ConfidenceDot, AuthButton  (detail is an in-page modal, not a route)
  lib/
    storage.ts      # localStorage read/write for warped2026:status + :order + :profile (logged-out path + cloud cache)
    personal.ts     # usePersonalState — thin reader over PersonalStore (status + order)
    profile.ts      # useProfile / useExplorerData — thin readers over PersonalStore (re-score seam); re-exports profile storage
    personalStore.tsx # OWNS {status,order,profile}; switches localStorage↔Firestore by auth; first-login merge + onSnapshot (PRD §12)
    auth.tsx        # AuthProvider + useAuth — optional Google sign-in (client-only, degrades to logged-out)
    firebase.ts     # Client-only Firebase init from NEXT_PUBLIC_FIREBASE_*; returns null when unavailable (never throws)
    cloud.ts        # Firestore read/write/subscribe for warped_users/{uid} (JSON-blob doc; namespaced; shared project)
    merge.ts        # PURE login-merge + coerce of PersonalSnapshot (union picks, cloud wins) — unit-tested, no Firebase
    bands.ts        # Load + type bands.json
    preview.ts      # resolvePreview(deezer_id) — fetch a fresh preview URL via /api/preview (session-cached)
    scoring.ts      # SINGLE SOURCE of the re-score algorithm (port of refresh-data.mjs) + TasteProfile
    tasteCsv.ts     # Parse an uploaded Spotify taste CSV → TasteProfile (defensive)
    csv.ts          # RFC-4180 CSV tokenizer (dependency-free)
  types/            # Band + dataset TypeScript interfaces (mirror bands.json)
tests/              # node --test suites (csv / tasteCsv / scoring / merge) + TS resolution hook
```

**See also**: `PRD.md` — full product reference (data contract, UI requirements, sharp edges, backlog, data pipeline; the upload/re-score feature is **§10**, the predicted schedule page is **§11**).
