# PRD.md — Warped Tour Long Beach 2026 Band Explorer

## 1. Overview

A single-user, static web app that helps me prep for **Vans Warped Tour — Long Beach 2026** (July 25–26, Shoreline Waterfront) by browsing all ~149 bands ranked by how likely I am to enjoy them, based on my Spotify listening data.

**Core value:** open the app, see which bands to prioritize, listen to a 30-second preview, mark a personal must-see / maybe / look-into / skip, and jump to the artist on Spotify.

**Scope for this build (MVP):**
- Owner-first, but **shareable**: by default the app shows the owner's pre-computed scores; a friend can upload their own Spotify taste CSV to **re-score every band live in their own browser** (Section 10). Still no auth, no accounts — the re-score is 100% client-side. The app is static except for one tiny keyless route, `GET /api/preview`, which resolves fresh (non-expired) 30-sec preview URLs at play time (§5.2, §8.4).
- All band data is pre-computed and shipped as a static `bands.json` (already built — do not regenerate as part of app work; see Section 8 for the refresh script). The uploaded-taste feature **reuses** `bands.json` as the catalog and recomputes only the taste-dependent fields (Section 10) — it never modifies `bands.json`.
- Personal must-see/maybe/skip state persists in **browser localStorage** by default. **Optional Google sign-in** (Section 12) layers cloud sync on top: signed-in users get their picks/order/profile synced to Firestore across devices; **signed-out behavior is unchanged** (localStorage only). Login is purely additive and never required.
- The uploaded profile is a separate localStorage key and never touches picks (and, when signed in, syncs as its own field in the same per-user doc).
- **Spotify export** (Section 13) — **currently DISABLED**: Spotify's May 2025 policy blocks playlist creation for development-mode apps (403 for everyone), with no quota path for a hobbyist app. The feature is gated off (`SPOTIFY_EXPORT_ENABLED = false`); the code is left intact. See §13 for the full diagnosis.

**Explicitly out of scope for MVP** (see Section 7 backlog): full multi-user Spotify **OAuth** (the upload feature is the lightweight, no-backend alternative — Section 10), live Spotify playback (full tracks), set-times / stage assignments. (Cross-device sync of personal picks is now **optionally** available via sign-in — Section 12 — but is never required.)

## 2. Page Inventory

| Route | Purpose | Notes |
|---|---|---|
| `/` | Main list/explorer view | Search, filter, sort, band rows, plus a "show only my picks" toggle. Default landing. |
| `/picks` | My Picks view | Real route. The bands you've marked, grouped by status (Must see / Maybe / Look into / Skip), with per-section reorder (drag + up/down-arrow fallback) and status-visibility toggles. |
| `/schedule` | Predicted schedule view | Real route. A **PREDICTED** time-grid (Section 11): stages are columns over a shared time axis, acts time-sorted with same-start acts aligned across columns and a confidence dot. Day toggle; a mobile stage picker shows 1–2 columns on a phone (all stages on desktop). Prominent "not official" disclaimer. Reads the `pred_*` fields + `schedule` block from `bands.json`; taste-independent. |
| `/callback` | Spotify OAuth redirect target | Real route, client-only. Receives `?code&state` from Spotify, exchanges the code for tokens (PKCE), then routes to `/picks` (Section 13). Shows a spinner + friendly error/allowlist message. No content of its own. |
| (in-page modal) | Band detail view | **Implemented as an in-page modal/drawer, not a route.** Chosen over `/band/[slug]` to avoid slug/punctuation issues (band names contain `.`, `,`, `...`). Opened from `/`, `/picks`, and `/schedule`. Detail content per Section 5 (incl. the predicted-slot line, §11). |

Three routes (`/`, `/picks`, `/schedule`), connected by a header tab on every page; the detail view is an in-page modal opened from any of them — there is **no `/band` route**. Rows, personal state, and the saved pick order are all keyed by exact band `name` (unique in the dataset), so no slugification is needed and a `bands.json` refresh never orphans them.

## 3. Data Model

There is **no database**. The entire data layer is one static file: `public/bands.json` (≈195 KB, 149 bands).

### 3.1 Top-level shape

```json
{
  "event": { "name", "dates", "venue", "band_count" },
  "scoring": { "windows": [...], "method": "...", "note": "..." },
  "all_genres": ["alternative","emo","metal", ...],   // 13 filterable parents
  "buckets": ["In your rotation","Must see","High match","Long shot","Discovery"],
  "schedule": {                                        // days OFFICIAL; stage/time PREDICTED (§11)
    "status": "PREDICTED",
    "disclaimer": "...days now official; stage/times not official; real times post on-site...",
    "method": "...how the prediction was derived...",
    "stages": ["Mainstage","Side Stage","Discovery Stage","Local/Opener Stage"],
    "days": ["Sat Jul 25","Sun Jul 26"],
    "real_times_available": false,                     // flips true when real times entered
    "days_official": true                              // Sat/Sun split is the released day-by-day lineup (optional; older files lack it)
  },
  "bands": [ Band, ... ]
}
```

The `schedule` block is **additive and PREDICTED** (Section 11). Older `bands.json` files may lack it; the app treats it as optional and the Schedule page degrades to "not available."

### 3.2 Band object (the contract — every field is present on every band)

| Field | Type | Meaning | UI use |
|---|---|---|---|
| `name` | string | Artist name (unique) | Title; slug source |
| `score` | number | 1.0–5.0, half-point steps | Sort key, star display, color chip |
| `bucket` | string | Human label for the score tier | Section headers / badge |
| `match_kind` | string | `direct-now` / `direct-6mo` / `direct-life` / `similar` / `genre` / `scene` / `none` | Drives `why` + optional icon |
| `why` | string | One-line plain-English reason for the score | Detail view + optional row subtitle |
| `genres` | string[] | 1–3 collapsed parent genres | **Filter source** (must match `all_genres`) |
| `raw_tags` | string[] | Up to 6 raw MusicBrainz tags | Secondary, detail view only (optional) |
| `bio` | string | 1–3 sentence generated blurb | Detail view |
| `similar_you_listen` | string[] | Similar artists that ARE in my library | Detail — "Similar artists you listen to" (the persuasive list) |
| `similar_general` | string[] | Similar artists NOT in my library | Detail — "Similar artists generally" |
| `genre_overlap` | string[] | My genres this band matches | Optional detail chip row |
| `top_track` | string\|null | Most popular track title | Player label |
| `preview_url` | string | 30-sec MP3 preview (Deezer CDN). **Expected-stale** — a signed link with a same-day TTL; not the play source. Empty string if none (1 band). | Last-ditch fallback only; the player resolves a fresh URL from `deezer_id` at play time (§5.2, §6) |
| `album` | string | Album of the top track | Player subtitle (optional) |
| `image` | string | Artist image URL (Deezer CDN, 250px) | Avatar |
| `fans` | number | Deezer fan count | Secondary sort / tie-break |
| `deezer_id` | number\|null | Deezer artist id | Future use |
| `spotify_search_uri` | string | `spotify:search:<name>` — opens Spotify **app** | "Open in Spotify" primary |
| `spotify_web_url` | string | `https://open.spotify.com/search/<name>` — browser fallback | "Open in Spotify" fallback |
| `pred_stage` | string | **PREDICTED** stage (one of `schedule.stages`), e.g. "Mainstage" | Schedule grid section (§11) |
| `pred_day` | string | **PREDICTED** day (one of `schedule.days`), e.g. "Sat Jul 25" | Schedule day toggle (§11) |
| `pred_time` | string | **PREDICTED** start time, display string, e.g. "6:18 PM" | Schedule row label + detail slot line |
| `pred_time_min` | number | **PREDICTED** start, minutes since midnight (720–1350) | Schedule sort key + conflict math |
| `pred_setlen_min` | number | **PREDICTED** set length in minutes (25–40) | Conflict overlap math (§11) |
| `pred_confidence` | string | **PREDICTED** confidence: `high` / `medium` / `low` | Confidence dot + legend (§11) |
| `user_status` | null | Placeholder. **Do not read/write this field.** Personal status lives in localStorage (Section 4). | — |

**Important:** `user_status` in the JSON is always `null` and is a frozen artifact of the data build. The app must NOT mutate `bands.json`. All personal state is localStorage-only.

**The `pred_*` fields are PREDICTED, not official** (Section 11) — a heuristic guess at stage/day/time, **not** real set times (Warped only posts those on-site). They are taste-independent (the same for the owner and any uploaded-profile viewer) and survive a re-score unchanged. Typed **optional** in `src/types` so the Schedule grid degrades gracefully if a future band lacks them; present on every band in the current dataset.

## 4. Personal State (localStorage)

Three localStorage keys hold all user-writable state (`warped2026:status`, `:order`, `:profile`). The app NEVER writes `bands.json`. **When signed in (Section 12), these same three shapes sync to Firestore** (one per-user doc) with localStorage kept as a mirror/offline cache; **signed out, it is localStorage only — exactly as described below.** The read/write contracts in this section are unchanged either way: the storage backend is swapped behind `usePersonalState` / `useProfile` by the shared `PersonalStore`, so the rest of the app is agnostic.

### 4.1 Status — `warped2026:status`
- **Shape:** `{ [bandName: string]: "must" | "maybe" | "look" | "skip" }`. Absence = unset.
- **Four statuses, ordered** must → maybe → look → skip. `look` ("Look into") = "need to listen more before deciding," and sits between maybe and skip in precedence. The canonical ordered value-set lives in one place — `STATUSES` in `src/lib/storage.ts` — which `BandStatus` (types), the validator, the order-map, and the UI all key off.
- **Backward compatible:** the loader validates each stored value against the set, which is now a *superset* of the old three, so existing `must`/`maybe`/`skip` data keeps working untouched — no migration, no data loss when the fourth status ships.
- **Why keyed by name:** band names are unique and stable in the dataset; this survives `bands.json` refreshes without an id migration.
- **Write:** on toggle, read the object, set/clear the band's key, write back. Clearing (toggling off) removes the key.
- **Read:** load once on mount into app state; keep localStorage and in-memory state in sync.
- **Reset:** a small "Clear my picks" affordance empties the key after a confirm (and also clears `warped2026:order`).

### 4.2 Pick order — `warped2026:order`
- **Shape:** `{ [status: "must"|"maybe"|"look"|"skip"]: string[] }` — each value an ordered list of band names for that My-Picks section (four sections now, one per status).
- **Purpose:** persists manual drag/arrow reordering on `/picks`.
- **Fallback:** a name absent from its section's array (or a missing key) falls back to match-score order (desc, ties by `fans` desc); newly-picked bands append until moved.
- **Sync:** changing or clearing a band's status removes it from every order array (no stale names accumulate); a per-section "Reset to score order" deletes that section's array; "Clear my picks" removes the whole key.
- **Keyed by name** for the same refresh-safe reason as status.

### 4.3 Uploaded taste profile — `warped2026:profile`
- **Shape:** `TasteProfile` — `{ version: 1, label?: string, windows: { short_term, medium_term, long_term: { artists: string[], genres: string[] } } }`. Absent = the owner's default view (Section 10).
- **Purpose:** holds a friend's parsed Spotify taste so the app can re-score `bands.json` against it client-side. This is the **only** writer/reader of taste data at runtime; `bands.json` is never written.
- **Separate from picks:** loading, replacing, or clearing a profile **never** touches `warped2026:status` or `warped2026:order`. A re-score does not wipe picks (verified). Picks remain the viewer's own per-browser state.
- **Defensive load:** the loader coerces/validates stored JSON into a `TasteProfile`; anything unusable (or an empty profile) is treated as "no profile" → default view. SSR-guarded (client-only).
- **Clearing** ("Use default") removes only this key.

Beyond these three keys, do **not** use `localStorage` for anything else — no analytics, no caching of `bands.json` (it ships with the app).

## 5. UI Requirements

Reference mockup behavior was approved in chat. Build to this:

### 5.1 List view (`/`)
- **Header:** event name + dates + venue, and a live count of visible bands.
- **Controls row:**
  - Search input — filters by `name` (case-insensitive substring). Live/onChange.
  - Genre filter — `<select>` populated from `all_genres`; "All genres" default. A band matches if the selected genre is in its `genres` array.
  - Sort `<select>`: **Match (high→low)** [default], Name (A–Z), Genre. Match sort ties broken by `fans` desc.
  - A **Sat/Sun day filter** (`DayFilter`) — a compact 3-way toggle **All / Sat 25 / Sun 26** (default **All**). Reads each band's `pred_day` (schedule data, taste-independent); when set to a day, only that day's bands show and the live count reflects the filtered set. **Composes** with search/genre/sort/only-picks (an additional filter, not a replacement). Day labels are read from `schedule.days` and shortened for mobile; a band with no `pred_day` (shouldn't happen — all 149 carry one) never matches a specific day, so it's simply hidden under Sat/Sun, never a crash.
  - A **"show only my picks"** toggle — when on, shows only bands with any saved status; composes with search/genre/sort/day and the live count. (Implemented; supersedes the old optional status-filter idea. Full per-status browsing lives on `/picks`, §5.4.)
- **Rows:** each band row shows avatar (`image`, fallback to initials), `name`, genre line (`genres` joined), a star rendering of `score`, a colored score chip, and the user's status marker if set. Click/tap opens detail.
  - **Score chip color:** ≥4.5 green, 3.5–4.0 amber, <3.5 neutral/gray. (Match the buckets, not arbitrary cutoffs — `In your rotation`/`Must see` = green, `High match` = amber, rest = gray.)
- **Grouping (optional but recommended):** group rows under `bucket` headers when sorted by Match. When sorted by Name/Genre, flat list.

### 5.2 Detail view (modal or route)
- Header: avatar, `name`, `genres` as pills, and the score block (number + stars + bucket label).
- `why` line under the score.
- `bio` paragraph.
- **Preview player:** a custom play/pause button over an `<audio>` element. The stored `preview_url` is a **time-limited Deezer signed link that expires within ~a day**, so it is **not** the play source. On play we resolve a **fresh** 30-sec preview URL on demand from the band's `deezer_id` via the `GET /api/preview` route (Deezer blocks direct browser fetch via CORS — see §6/§8), set it on the `<audio>`, and play. Show a brief loading state while resolving; resolved URLs are memoised in memory for the session. Show `top_track` (and `album`) as the label. If a band has **no `deezer_id`** (and no stored URL), show "No preview available." On resolution/playback failure, show a brief "Preview unavailable" and reset the button (never the old flash-and-stop).
- **"Open in Spotify" button:** primary action uses `spotify_search_uri` (opens the app). Because `spotify:` URIs can fail silently in some browsers, implement: try the `spotify:` URI, and provide a visible secondary link to `spotify_web_url`. Do not rely on the app URI alone.
- **Two similar-artist lists, side by side:**
  - "Similar artists you listen to" → `similar_you_listen` (emphasize visually — this is the persuasive one). If empty, omit the heading.
  - "Similar artists generally" → `similar_general` (muted). If empty, omit.
- **Status toggle:** four-state control (Must see / Maybe / Look into / Skip) writing to localStorage per Section 4. Laid out 2×2 so all four labels keep ≥44px tap targets on a phone. Reflect current state; allow clearing (tap the active one again). Colors are distinct: must = rose, maybe = sky-blue, **look into = yellow** (dark text for contrast), skip = zinc — chosen so the four read apart on a phone in sunlight.

### 5.3 Design
- Follow the repo's `frontend-design` conventions if present. Otherwise: clean, flat, mobile-first (this gets used on a phone at the festival). Tailwind. No heavy chrome.
- **Mobile is the priority target** — I'll use this on my phone on-site. Tap targets ≥44px, fast, works one-handed.

### 5.4 My Picks view (`/picks`)
- Reads `warped2026:status`; shows picked bands grouped into **Must see / Maybe / Look into / Skip** sections, in that order. Each section has its own reorder (drag + arrows), "Reset to score order", and empty state ("Nothing marked [status] yet" — e.g. "Nothing marked Look into yet").
- **Status-visibility toggles** (Must / Maybe / Look into / Skip chips — four now) at the top control which sections render — a view filter only; all on by default; does not change stored status.
- **Sat/Sun day filter** (the same `DayFilter` All / Sat 25 / Sun 26 control, default **All**) sits under the status chips. When set to a day, each status section shows only the picks playing that day (by `pred_day`); a section with no picks for that day shows a "Nothing marked [status] for [day]" empty state. **Reorder under a day filter is safe:** the new visible order is re-woven back into the full saved section order, so the hidden day's picks keep their positions (a day filter never drops or scrambles the other day). Default **All** is unchanged behavior. Taste-independent — works the same logged in/out and with/without an uploaded profile.
- **Reorder within a section:** drag the grip handle (Pointer Events — works with touch and mouse) or use the per-row up/down arrows (the touch-reliable fallback). Order persists to `warped2026:order` (§4.2). A per-section "Reset to score order" reverts to match-score order.
- Rows reuse the list-view `BandRow` look and open the **same** detail modal (§5.2).
- Empty states: a section with no bands shows "Nothing marked [status] yet"; with no picks at all, a friendly hint to mark bands on the Lineup.

## 6. Known Sharp Edges

- **`bands.json` is read-only at runtime.** Never write to it. Personal state is localStorage only. The `user_status` field inside the JSON is a frozen `null` and must be ignored.
- **Similar-artist data is from Deezer, not Spotify.** Spotify deprecated its Related Artists / Recommendations / Audio Features endpoints for new apps (Nov 2024), so none of those can be called from a new Spotify app. Don't try to "upgrade" similar-artists by calling Spotify — it will 403.
- **Spotify links are search URLs, not artist-ID deep links.** `spotify:search:<name>` opens the app to a search, not directly to the artist page. This is a deliberate MVP tradeoff (no Spotify API access at build time). Exact deep-linking is a backlog item (Section 7).
- **A few genre tags are imperfect.** MusicBrainz tagging is crowd-sourced; e.g. a band may carry a broad/odd parent genre. The data is good enough for filtering; don't hand-tune inside the app.
- **Stored `preview_url` is expected-stale and must NOT be the audio source.** It's a Deezer signed CDN link carrying an `hdnea=exp=<unix>` token with a ~same-day TTL; once expired the CDN returns **403**, the `<audio>` errors (`MEDIA_ERR_SRC_NOT_SUPPORTED`), and `play()` rejects. The player resolves a **fresh** URL at play time from `deezer_id` via `GET /api/preview` (§5.2, §8). The stored URL is kept only as a last-ditch fallback (assume it's expired).
- **`preview_url` can be empty** for 1 band (148/149 have previews); that band (`Gritty in Pink Jam`) also has `deezer_id: null`, so it has **no** resolvable preview — keep "No preview available." Always guard the player.
- **Deezer's API has no CORS for browsers.** `api.deezer.com` does not send `Access-Control-Allow-Origin`, so a direct client-side `fetch` is blocked. Preview resolution therefore goes through the app's own `GET /api/preview?id=<deezer_id>` route (keyless, no secrets) — the **only** runtime backend hop in the app (§8).
- **The lineup was the near-final March reveal.** ~8 slots were unannounced at data-build time. The app must render whatever is in `bands.json` and not assume a fixed count. When the final bands drop, regenerate via the refresh script (Section 8) — don't hardcode additions.
- **Preview URLs are HTTPS from Deezer's CDN** (both the stored one and the freshly resolved one are `https://…dzcdn.net`); no mixed-content.
- **Band names contain punctuation** (`The Academy Is...`, `Drop Dead, Gorgeous`, `Letlive.`, `Bear Vs. Shark`). Slugify defensively if using routes; prefer matching by exact `name`.
- **Status colors are rose / sky-blue / yellow / zinc** (must / maybe / look / skip) — *not* the green/amber the score chip uses. "Maybe" is sky-blue, so the yellow "Look into" is already clearly distinct from it (no amber-vs-yellow clash on the toggle). The one place yellow sits near amber is a list row, where the gold stars and an amber score chip share space with a yellow "Look" badge — they're kept apart by position and by using a brighter lemon-yellow (`yellow-400`) for status vs amber for score. When adding a fifth status, re-check this on a real row.
- **The predicted schedule is TASTE-INDEPENDENT and must stay that way.** The `pred_*` fields and the `schedule` block are based on artist draw, not anyone's Spotify data, so the Schedule page (§11) reads them straight from `bands.json` and renders identically for the owner and any uploaded-profile viewer (verified: the rendered grid is byte-identical with and without a profile). It works because `rescoreBand`/`rescoreDataset` spread the original band/dataset (`{...band}` / `{...dataset}`), so the `pred_*` fields and `schedule` survive a re-score untouched — do **not** add the schedule to the "recomputed per-user" list (§10.2), and don't compute slots from the profile.
- **`pred_*` stage/time are PREDICTED, never present them as official.** The Schedule page leads with a non-dismissable "PREDICTED — not official" banner (`schedule.disclaimer`). **Days (Sat vs Sun) are now OFFICIAL** (`schedule.days_official: true`) — the released day-by-day lineup, no longer the lowest-confidence guess — so the Sat/Sun day toggle and the new Sat/Sun day filter on Lineup/Picks (§5.1, §5.4) read official day data. Stage and start-time remain heuristic predictions; the disclaimer wording reflects that ("days official, times predicted"). When real on-site times are entered later, `schedule.real_times_available` flips to `true` (see §11's swap-in plan).
- **The upload modal must portal to `<body>`.** Its entry point (`ProfileBar`) lives inside the page's sticky header, whose `backdrop-blur` (a `backdrop-filter`) establishes a containing block for `position: fixed`. Rendered in place, the modal's `fixed inset-0` resolves against the *header* — not the viewport — and shoves the panel and its close button above the screen. `UploadProfileModal` therefore `createPortal`s to `document.body`; any future modal opened from inside a transformed/filtered/`backdrop-blur` ancestor needs the same.
- **The favicon is generated, not hand-drawn.** `scripts/gen-favicon.mjs` is the single source of truth for the guitar shape and emits both `src/app/icon.svg` (primary, Next 16 file convention) and `src/app/favicon.ico` (3-size PNG-in-ICO fallback). Edit the geometry in that script and re-run `node scripts/gen-favicon.mjs`, then commit both outputs — don't hand-edit `favicon.ico`. Next auto-wires both via the App-Router file convention (no `metadata.icons` needed); a stray `favicon.ico` plus an `icon.svg` is the intended setup.
- **Adding a status is backward-compatible by construction.** The status validator keys off `STATUSES` (a superset after each addition), so old localStorage survives. Removing or renaming a status is *not* safe the same way — stored values for the dropped key would be silently discarded on load.
- **Re-scored "similar artists you listen to" is bounded by `bands.json`.** On an uploaded-profile re-score (Section 10), the only matching material is each band's stored `similar_general` ∪ `similar_you_listen` (a truncated reconstruction of the original Deezer related list) and `raw_tags`. Some bands have thin similar lists, so a friend's "similar" matches can be under-counted. **Direct artist matches are exact**; similar/genre matches are best-effort. This is disclosed in the upload dialog and the detail modal — don't oversell it.
- **The re-score algorithm lives in two places by design.** `scripts/refresh-data.mjs` bakes the owner's `bands.json` offline; `src/lib/scoring.ts` is a faithful TypeScript **port** that re-scores live in the browser. They are intentionally two copies of one algorithm — change one, mirror the other (and update `scoring.ts`'s tests). `direct-life` scores **4.5** (→ "Must see"), matching the generator, not 4.4.
- **`normalizeArtist` is looser than the generator's match.** The re-score matches artist names with diacritics folded and all non-alphanumerics stripped (so "Panic! At The Disco" ↔ "panic at the disco"). It's applied symmetrically and only on the re-score path; the default owner view reads `bands.json` verbatim, so it's unaffected.

## 7. Feature Backlog

- [ ] **Spotify artist deep-links** — resolve each band to a Spotify artist ID (via Spotify search API during the data-refresh step, server-side) and store `spotify_uri`/`spotify_url` so links open the artist page directly instead of a search.
- [x] **Set-times / stage view** — DONE as a **prediction**: `/schedule` shows a day/stage/time grid from the baked `pred_*` fields + `schedule` block, with a must-see conflict detector (Section 11). Heuristic, not official — clearly disclaimed. Swapping in real on-site times later is the remaining step (§11).
- [x] **Status filter / My Picks** — DONE: `/picks` page (bands grouped by status, reorderable with drag + arrows) plus a "show only my picks" toggle on `/`. See §2, §4.2, §5.4.
- [x] **Friend sharing / multi-user (lightweight)** — DONE: a friend uploads their Spotify taste **CSV** and the app re-scores every band live in their browser, fully client-side (Section 10, `warped2026:profile`). No backend, no OAuth.
- [ ] **Multi-user mode (full OAuth)** — Spotify OAuth (`user-top-read`) so others connect without exporting a CSV, and scores sync. Requires a runtime/server step and a backend. Still deferred by design; the upload feature above covers the no-backend case.
- [x] **Cross-device sync** of personal picks — DONE (optional): Google sign-in + Firestore per-user sync (Section 12). Signed-out stays localStorage-only; sign-in is additive and never required.
- [~] **Export picks to a Spotify playlist** — BUILT then DISABLED (Section 13): connect Spotify (Authorization Code + PKCE) and build a private playlist from your picks, 2–3 tracks/band. **Blocked by Spotify's May 2025 dev-mode policy** (playlist writes return 403 for all dev-mode apps; Extended Quota unavailable to a hobbyist app). Gated off via `SPOTIFY_EXPORT_ENABLED`; code retained for if quota is ever granted.
- [ ] **"Surprise me"** — highlight high-score bands I haven't marked yet.

## 8. External Services & Data Refresh

The app is static except for **one** tiny runtime route: `GET /api/preview?id=<deezer_id>` resolves a fresh 30-sec preview URL from Deezer at play time (the baked `preview_url` is a same-day signed link that expires — §5.2, §6). The route is keyless, holds no secrets, and does nothing but read `data[0].preview` from `api.deezer.com`; it exists only because Deezer doesn't send CORS headers for a direct browser fetch. **All other** enrichment happens offline in the data-refresh script (committed at `scripts/refresh-data.mjs`); no other runtime external calls exist (the upload re-score in §10 is pure client-side).

### 8.4 `/api/preview` route
- **In:** `id` (a band's `deezer_id`). **Out:** `{ "preview": string | null }`.
- **Does:** server-side `GET https://api.deezer.com/artist/{id}/top?limit=1` → returns `data[0].preview` (a freshly-signed MP3 URL). 400 on a bad/missing id; 502 on upstream failure; `Cache-Control: no-store` (URLs are short-lived). Keyless, no env vars, no secrets.
- **Why it's the only acceptable backend:** Deezer's `api.deezer.com` omits `Access-Control-Allow-Origin`, so a direct client `fetch` is CORS-blocked (verified). A minimal server hop is the smallest fix that keeps the player working as tokens expire daily.

### 8.1 What the refresh script does
Regenerates `public/bands.json` from two inputs:
1. The lineup (band-name list) — update when new bands are announced.
2. My taste profile (top artists + genres across 1-month / 6-month / lifetime windows), exported from Spotify.

Pipeline (no API keys required — all sources are keyless):
- **Deezer API** (`api.deezer.com`, keyless): per band → artist search, `/artist/{id}` (fan count), `/artist/{id}/related` (similar artists), `/artist/{id}/top` (top track + 30-sec `preview` URL), image.
- **MusicBrainz** (`musicbrainz.org/ws/2`, keyless, **rate-limit ≤1 req/sec**, set a `User-Agent`): per band → genre tags, country/area, begin year.
- **Scoring:** recency-weighted artist match (1-month ×1.0, 6-month ×0.7, lifetime ×0.55) as the dominant signal; genre overlap as a minor floor. `5.0` = in current (1-month) rotation; `4.5` = strong taste match; lower = exploratory. Genres collapsed to 13 parent buckets for filtering.

### 8.2 Refresh runbook
- Update `scripts/lineup.txt` (one band per line) and/or `scripts/taste_multi.json` (the three-window export).
- Run the script. It writes `public/bands.json`.
- Verify: band count is sane, `previews` count is ~all, score distribution isn't all-1.0 (that signals a taste-parse break).
- Commit `public/bands.json` + any script change together.

### 8.3 Env vars
None required for the app or the refresh script. There is no `ANTHROPIC_API_KEY`, no Firebase, no Spotify secret in this project. If multi-user (backlog) is ever built, that introduces Spotify OAuth secrets — server-only, never `NEXT_PUBLIC_*`.

## 9. Data Provenance (for reference)

`bands.json` was generated against my Spotify export covering three windows (lifetime / 6-month / 1-month top artists + genres). Similar artists: Deezer. Genre tags + origin: MusicBrainz. Previews: Deezer CDN. Event: 149 bands, July 25–26 2026, Shoreline Waterfront, Long Beach (lineup re-cross-referenced against the official page). Buckets: In your rotation (26) · Must see (30) · High match (32) · Long shot (34) · Discovery (27).

## 10. Upload Your Taste — Client-Side Re-Score

Makes the app **shareable without a backend**. By default it shows the owner's baked scores; a friend can upload their own Spotify taste CSV and the app re-scores every band **live in their browser**. No network calls, no API keys, no server — `bands.json` is the only matching material and stays read-only.

### 10.1 Data flow
1. **Upload** (`ProfileBar` → `UploadProfileModal`): the friend picks/drops a `.csv`, sees the chosen filename, then presses **Upload & re-score** to confirm (explicit submit — no auto-apply on file-pick). A parse error shows in-modal and keeps the dialog open; the modal links out to a CSV template + stats.fm fill-in steps.
2. **Parse** (`src/lib/tasteCsv.ts` on `src/lib/csv.ts`): extract per-window ordered **top artists + top genres** for Lifetime / 6 months / 1 month. Defensive — a malformed file shows a clear error and never corrupts state.
3. **Store** (`src/lib/profile.ts` → `warped2026:profile`, §4.3): the parsed `TasteProfile`, separate from picks.
4. **Re-score** (`src/lib/scoring.ts`): `rescoreDataset(bands.json, profile)` returns a new dataset with the taste-dependent fields recomputed. The pages consume the effective dataset via `useExplorerData()`.
5. **Render**: list rows, bucket grouping, detail modal, and My-Picks score-fallback ordering all reflect the re-score. A `ProfileBar` shows whose view is active ("default" vs "your upload") with **Replace** / **Use default**.

With **no** profile, `useExplorerData()` returns `bands.json` unchanged (same object reference) — the owner's default view is byte-for-byte identical.

### 10.2 Recomputed vs frozen fields
- **Recomputed per-user:** `score`, `bucket`, `match_kind`, `why`, `similar_you_listen`, `similar_general`, `genre_overlap`, and the personalised tail of `bio` (the owner's "heavy rotation" sentence is stripped; re-added only for the friend's own current-rotation bands — never leak the owner's matched artists).
- **Frozen / reused as-is (taste-independent):** `name`, `genres`, `raw_tags`, the factual first part of `bio`, `top_track`, `preview_url`, `album`, `image`, `fans`, `deezer_id`, `spotify_search_uri`, `spotify_web_url`.

### 10.3 The CSV format (parsed, not assumed positionally)
A 2-row header over 9 columns: three windows (**Lifetime / 6 months / 1 month**), each with **Top Genres / Top artists / Top tracks**. Header row 1 = window labels (often merged → blank-filled); header row 2 = category labels. Columns are mapped by **detecting** each label (artists vs genres vs tracks), so the 1-month group's columns may be shuffled. Rank prefixes ("1. ") and embedded sub-header rows ("Your top artists from the past 6 months") are stripped. A positional fallback (Lifetime → 6mo → 1mo) covers files whose window labels aren't detectable. Tracks are parsed but unused by scoring.

### 10.4 The algorithm (one source, two homes)
`src/lib/scoring.ts` is a **faithful TypeScript port** of the scoring in `scripts/refresh-data.mjs` — same constants, `GENRE_RULES`, cascade, `bucketForScore`, and `whyFor`. The cascade: 1-month artist → 5.0 `direct-now`; 6-month → 4.5 `direct-6mo`; lifetime → 4.5 `direct-life`; else N of your artists in the band's similar pool → 3.5/4.0/4.5 `similar`; else genre overlap → 1.5 (→ 2.0 if ≥3) `genre`; else parent-genre adjacency → 2.0 `scene`; else 1.0 `none`. Artist matching uses `normalizeArtist` (diacritics folded, non-alphanumerics stripped) on both sides. **Change one copy, mirror the other** (and update `scoring.ts`'s tests).

### 10.5 Constraints / sharp edges
- The re-score is **pure client-side** — no backend, no network/API calls for scoring. `bands.json` is read-only and never re-saved. (The unrelated `/api/preview` route in §8.4 is the app's only runtime hop, and it's not involved in scoring.)
- Re-scored "similar artists you listen to" is bounded by each band's stored similar lists (some are thin) — disclosed in-UI; direct matches are exact (see §6).
- All file/localStorage/parsing is client-only (SSR-guarded).
- The default no-profile experience is unchanged.

### 10.6 Tests
`npm test` runs dependency-free `node --test` suites (Node ≥ 22 native TS) under `tests/`: the CSV tokenizer, the taste-CSV parser (incl. shuffled groups, sub-header stripping, positional fallback, malformed-input errors), and the scoring port (tier/bucket snapping, `similar_you_listen` recompute, bio handling, and a real-`bands.json` check that no-profile is unchanged and a re-score doesn't mutate the baked file). A test-only resolution hook (`tests/ts-resolve.mjs`) lets Node resolve the app's `@/…` and extensionless imports; `tests/` is excluded from the Next build's type-check.

## 11. Predicted Schedule (`/schedule`)

A day-by-day, stage-by-stage view of **when each band is predicted to play**. The whole feature hinges on one promise: **it is a heuristic prediction, never presented as official set times.**

### 11.1 The data (baked into `bands.json`, read-only)
- **Per band** (§3.2): `pred_stage`, `pred_day`, `pred_time` (display string), `pred_time_min` (minutes since midnight, the sort/conflict key), `pred_setlen_min`, `pred_confidence` (`high`/`medium`/`low`).
- **Top-level `schedule` block** (§3.1): `status` (`"PREDICTED"`), `disclaimer`, `method`, `stages[]` (display order), `days[]` (display order), `real_times_available` (`false`), and **`days_official`** (`true`).
- **Days are now OFFICIAL.** As of the latest data swap, `pred_day` is the **released day-by-day lineup** (Warped published which bands play Saturday vs Sunday), and `schedule.days_official` is `true`. The disclaimer was updated to say *days are official, stage/time predictions remain*. The Sat/Sun split is no longer a guess. (Scoring fields — `score`/`bucket`/etc. — were unchanged by this swap; only the schedule fields were rebuilt within each official day.)
- **How it was derived** (`schedule.method`, for transparency): **day from the official released lineup**; within each day, stage tier from artist draw (named-headliner status + Deezer fan count, streaming-only crossover acts dampened, press-named headliners promoted to Mainstage); time slots spread each stage ~12:00 PM–10:30 PM, openers first, headliners closing. These are **read straight from the file** — the app never recomputes them.

### 11.2 The page
- **Header:** title + nav tab (Lineup / My Picks / Schedule) and a **day toggle** built from `schedule.days`.
- **Prominent disclaimer banner** (non-dismissable, warning-colored): renders `schedule.disclaimer` under a "PREDICTED — not official" heading, plus "Real set times post on-site when gates open." This is the integrity of the feature — keep it unmissable.
- **Confidence legend:** high = named headliner, medium = main-stage/high-draw, low = inferred (mirrors `pred_confidence`).
- **Grid (time-grid):** for the selected day, **stages are columns** (in `schedule.stages` order) over a **shared time axis** — rows are the distinct `pred_time_min` values ascending, so acts that start at the same time line up across columns, and a stage with no act at a given time renders an empty cell (sparse columns stay aligned — Mainstage runs ~6 acts/day, Discovery ~27, yet the rows still line up). The left axis labels each row with `pred_time`. Each act cell shows the band name, a confidence dot, and (if set) the user's status badge + conflict marker; tapping a cell opens the shared `BandDetail` modal (which carries the predicted-slot line). Bands missing `pred_*` fields are silently skipped (never crash).
- **Mobile stage picker:** a 4-column grid doesn't fit a phone, so below the `lg` breakpoint the user picks **1–2 stages** to show as columns (chips, default = first 1–2; tapping a third swaps out the oldest; can't deselect the last). Desktop (`lg`+) shows every stage as a column with no picker. The time axis and time-sorting work identically in both modes; the picker never causes horizontal page scroll. SSR-safe: the wide/narrow split is a client-only `matchMedia` effect (starts narrow, resolves on mount).
- **Tapping a row** opens the shared `BandDetail` modal (§5.2), which also shows a **predicted-slot line** — `Predicted: <stage> · <day> · <time> · <confidence>` — so the slot is visible when a band is opened from any page.

### 11.3 Must-see conflict detector
If two bands the viewer marked **`must`** (`warped2026:status`) have overlapping predicted sets on the **same day** — intervals `[pred_time_min, pred_time_min + pred_setlen_min)` overlap — the page surfaces a count ("N must-see time conflicts on <day>") and marks each conflicting **cell** (the time-grid also makes a same-start clash visible as two filled cells on one row). The overlap test is cross-stage and exact-time-agnostic (a 6:18 act can clash a 6:25 act), so it's a real interval test, not just a same-row check. The count is computed across **all** stages, so it stays honest even when the mobile picker is hiding the column a conflicting act sits on. Conflicts are computed **per day** (you can't be two places at once on one day; a Sat act and a Sun act never conflict). Pure, client-only, SSR-safe (status loads in an effect; first render shows none).

### 11.4 Taste independence (do not break)
The schedule is the **same for everyone** — it's based on artist draw, not taste. The page reads `pred_*`/`schedule` from the effective dataset, and because `rescoreDataset` spreads the original band/dataset, those fields survive an uploaded-profile re-score unchanged. Opening a band from `/schedule` still shows that viewer's effective (re-scored) score in the modal — only the score is taste-dependent, never the slot. (See §6.)

### 11.5 Swapping in the real schedule on the day
When Warped posts real set times on-site, regenerate `bands.json` with the real `pred_*` values and set `schedule.status` to a non-"PREDICTED" label + `schedule.real_times_available: true`. The UI already keys its "PREDICTED" heading off `schedule.status`; a future tweak can drop/soften the banner when `real_times_available` is `true`. No band-shape change is needed — only the values flip. This stays a **data refresh** (§8), not app work.

## 12. Optional Auth + Cloud Sync (Google + Firestore)

Makes personal state **optionally** cross-device, without changing the default experience. **Logged out is the default and is byte-for-byte the app described in §1–§11** (localStorage only, no network for personal state, no gating). Signing in with Google switches the user's storage to a per-user Firestore document and syncs across devices. Login is **purely additive** and never required for anything.

### 12.1 The model
- **Auth:** Firebase Auth, Google provider, popup flow. A sign-in control lives in the header nav (`AuthButton`); signed in, it shows the account (avatar + name) and a sign-out menu. SSR-safe and **client-only** — Firebase initialises only in the browser.
- **Default = logged out = unchanged.** No account → status/order/profile live in localStorage exactly as §4 describes. Nothing about the list, picks, schedule, or upload re-score changes.
- **Signed in = Firestore-backed.** Reads/writes go to the user's Firestore doc; localStorage is kept as a **mirror / offline cache** so signing out retains data and the page never blocks on the network.
- **Graceful degradation:** if Firebase can't initialise (missing/blank `NEXT_PUBLIC_FIREBASE_*` env, network/init failure, or SSR), the app silently falls back to the logged-out localStorage behavior and the sign-in control renders nothing. It must **never** white-screen on auth.

### 12.2 The seam (storage-agnostic by construction)
A single client provider, `PersonalStore` (`src/lib/personalStore.tsx`), owns the user's whole writable state — `{ status, order, profile }` (a **`PersonalSnapshot`**) — and decides whether it's backed by localStorage (logged out) or Firestore (logged in). `usePersonalState` and `useProfile`/`useExplorerData` are now **thin readers over this provider**, so their contracts are unchanged and the rest of the app is agnostic to the backend. `bands.json`, scoring, schedule prediction, and the upload re-score are all **taste-/data-independent and untouched** — this feature only moves the *user's personal state* to optional cloud sync.

### 12.3 Firestore shape + namespacing (shared project — do not break)
- The Firebase project (`wdnnsp`, project id from env) is **SHARED** with at least one other app. This app touches **exactly one** collection: `warped_users`, one document per user keyed by auth uid — **`warped_users/{uid}`**. It never reads/writes the project root or any other collection.
- **Doc shape:** `{ data: string, schemaVersion: 1, updatedAt: <serverTimestamp> }`, where `data` is `JSON.stringify(PersonalSnapshot)`. The snapshot is stored as a **JSON string** (not structured Firestore maps) specifically because band names — the keys of the `status` map — contain punctuation Firestore disallows in nested map keys (`Letlive.`, `The Academy Is...`, `Drop Dead, Gorgeous`). The doc is only ever read whole by uid, never queried, so the blob has no downside. Reads coerce defensively via `coerceSnapshot`.

### 12.4 First-login merge (never lose marks)
On login the device's local snapshot is **merged into** the cloud doc (`src/lib/merge.ts`, pure + unit-tested):
- **status:** UNION of picks; on the **same** band, **cloud wins** (the established source). A local-only mark is never dropped.
- **order:** per section, cloud order first, then any local-only names appended (deduped).
- **profile:** cloud if present, else local.

The merge is **idempotent and non-destructive** (`merge(x, x) === x`; it never deletes a pick), so it's safe to run on every login — repeat logins don't re-run destructively. The store only writes the merge back when it actually added something the cloud lacked (skips a redundant write and avoids clobbering a concurrent remote write). After the merge it live-subscribes (`onSnapshot`) for cross-device updates, mirroring each remote change into localStorage. **Known semantic:** because picks are a union, a pick deleted on one device can be *resurrected* by another device's first-login local data — this is the deliberate "never silently lose marks" tradeoff, not a bug. Concurrent multi-device writes are last-write-wins at doc granularity (acceptable for this app's scale).

### 12.5 Security rules (output-only — deploy manually, append-scoped)
A user may read/write **only their own doc**: `allow read, write: if request.auth != null && request.auth.uid == uid;` scoped to `match /warped_users/{uid}`. The rules are in **`firestore.rules`** with a prominent "merge, don't replace" warning, and are **NOT deployed by this session** — they must be **appended** to the shared project's existing rules and deployed manually (deploying the file as-is would lock the other app out). Least-privilege: it exposes nothing outside `warped_users/{uid}`.

### 12.6 Env / config (public by design)
Firebase web config is read from `NEXT_PUBLIC_FIREBASE_*` (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`) — inlined at build time, never hardcoded in source. These values are **public by design**: the Firebase web SDK config ships to the browser and access is gated by **security rules, not secrecy** — so the "secrets are server-only" rule (§8.3, for hypothetical Spotify OAuth) does **not** apply to them. They live in `.env.local` (gitignored) and Vercel env. Authorized auth domains: `localhost` + the Vercel domain.

### 12.7 Sharp edges
- **All Firebase/Firestore/auth calls are client-only** (guard `window`/`localStorage`); the providers render empty on the server, so pages still prerender static and there's no hydration mismatch (`AuthButton` also guards on a mounted flag).
- **Never break the logged-out path.** `storage.ts` stays purely local; the cloud layer is layered on top by `PersonalStore`. If you touch the store, re-verify logged-out behavior is unchanged.
- **Don't widen the Firestore footprint.** Stay inside `warped_users/{uid}`; never write the root or another collection in the shared project. If you change the doc shape, bump `schemaVersion` and keep `coerceSnapshot` tolerant of old docs.
- **`bands.json` is still read-only and NOT in Firestore.** Only the user's personal state syncs.

## 13. Export to Spotify (optional, allowlist-only) — **DISABLED (Spotify policy block)**

> **⚠️ CURRENTLY DISABLED (May 2025 Spotify policy change).** Spotify now blocks
> apps in **development mode** from all **playlist-write** endpoints
> (`POST /users/{id}/playlists`, `POST/DELETE /playlists/{id}/tracks`) with
> **403 Forbidden** — for *everyone*, including the app owner and allowlisted
> users — and restricts some catalog reads (e.g. artist top-tracks) as well.
> This is **not** a code/scope bug: the authorize request already requests
> `playlist-modify-private`, `/me` and `/search` still return 200, and
> reconnecting does not help (a platform block, not a stale consent). The only
> escape is **Extended Quota mode**, whose eligibility was tightened to require a
> registered business + a service with **250k+ monthly active users** —
> unavailable to a hobbyist app. See Spotify SDK issue
> [spotify/spotify-web-api-ts-sdk#159](https://github.com/spotify/spotify-web-api-ts-sdk/issues/159).
>
> **State of the code:** the feature is gated **off** at a single chokepoint —
> the constant `SPOTIFY_EXPORT_ENABLED = false` in `src/lib/spotify.ts`, which
> forces `isSpotifyConfigured()` to return `false`. The Export button therefore
> **renders nothing** and no Spotify auth/network is ever initiated (it reuses the
> exact same "off" path as an unset client id). **All PKCE/export code below is
> left intact** — flip `SPOTIFY_EXPORT_ENABLED` back to `true` *only if* this app
> is ever granted Extended Quota. The rest of §13 documents the design as built,
> for that eventuality.

From the **My Picks** page the user can create a **private Spotify playlist** of their picks in their **own** account — 2–3 top tracks per band. This is **additive**: when it isn't configured or the user hasn't connected, the app behaves exactly as §1–§12 describe. It **reads picks only** — it never writes `bands.json` or personal state.

### 13.1 A SECOND, separate OAuth (not the Google sign-in)
- The export uses **Spotify** Authorization Code + **PKCE** — a **public client, NO client secret in the frontend**. It is **completely separate** from the optional Firebase **Google** sign-in (§12, which syncs picks). A user can be signed in (or not) and connected to Spotify (or not) independently; the two are never merged and are clearly labelled ("Connect Spotify" vs "Sign in").
- **Scope:** `playlist-modify-private` only (we always create **private** playlists; `playlist-modify-public` is intentionally not requested).
- **Redirect URI:** the app's own `/callback` route, derived at runtime from `window.location.origin` so it works on `localhost` and the Vercel domain (both must be on the Spotify app's allowlist).
- **Tokens:** held **in memory for the session** (module-scope in `src/lib/spotify.ts`), refreshed via the refresh token as needed. **Nothing sensitive is persisted** — only the PKCE **code-verifier** + state live transiently in `sessionStorage` across the auth redirect, and are deleted on token exchange. A full page reload ends the Spotify session (expected, by design).

### 13.2 Env / config (public client id)
- **`NEXT_PUBLIC_SPOTIFY_CLIENT_ID`** — the only Spotify env var; **public by design** (a PKCE public-client id, not a secret), read from `process.env`, set in `.env.local` (gitignored) + Vercel.
- **If it's missing, the feature is OFF:** `isSpotifyConfigured()` is false, the Export button **renders nothing**, and the app is unaffected. No crash, no console noise.
- There is **no Spotify client secret** anywhere (PKCE doesn't need one). A hypothetical future server-side Spotify secret would still be server-only — never `NEXT_PUBLIC_*`.

### 13.3 The flow
1. **Connect** (`ExportToSpotify`): the Export button opens a dialog; if not connected it shows **"Connect Spotify"**, which begins PKCE and redirects to Spotify's consent screen.
2. **Callback** (`/callback`): Spotify redirects back with `?code&state`; the page validates state, exchanges the code for tokens (client-side, no secret), then routes to `/picks?spotify=connected`, which auto-opens the dialog at the status step.
3. **Select statuses**: checkboxes for **Must / Maybe / Look into** (default **Must** checked; the user can add the others). **Skip is never exportable.** A live count shows "Export N bands → playlist".
4. **Export** (`src/lib/spotifyExport.ts`): for each selected band (ordered **Must → Maybe → Look into**, within each by score desc, ties by fans), search the artist on Spotify, take their top **2–3** tracks, **dedupe** across bands (cap 300 total), create a **private** playlist named `Warped Long Beach 2026 — My Picks (Jul 25-26)`, and add the tracks.
5. **Result**: success shows a **link to open the playlist**, the **track count**, and a **"couldn't find on Spotify"** list of skipped bands. One unmatched band never fails the whole export.

### 13.4 Track resolution
- Artist match prefers a **normalized exact** name match (reusing `scoring.ts`'s `normalizeArtist` — diacritics folded, non-alnum stripped); otherwise it trusts Spotify's relevance ranking (first result). No match → the band is **skipped and reported**, not an error.
- Top tracks come from `GET /v1/artists/{id}/top-tracks`, using the user's market (from `/v1/me`, falling back to `US`). Tracks are deduped by id; up to `TRACKS_PER_BAND` (3) per band.

### 13.5 Sharp edges / constraints
- **⚠️ Playlist writes are blocked in Spotify development mode (May 2025).** This is what disabled the feature (see the banner at the top of §13). `POST /users/{id}/playlists` and `POST/DELETE /playlists/{id}/tracks` return **403 Forbidden** for dev-mode apps regardless of scope or who is calling; some catalog reads (top-tracks) are restricted too, while `/me` and `/search` keep working. **No client-side code change fixes this** — switching to `POST /me/playlists` hits the same block. Extended Quota mode is the only path and is unavailable to a hobbyist app. The gate is `SPOTIFY_EXPORT_ENABLED` in `src/lib/spotify.ts`.
- **Allowlist-only (Spotify development mode).** We do **not** attempt production approval. If Spotify denies a non-allowlisted account (`error=access_denied` on the callback, or an auth error), the UI shows a **friendly message**: the account must be added to the app's allowlist, and the owner can add their Spotify email. Assume the user is allowlisted.
- **Rate limits (429):** the API helper honours `Retry-After` with a bounded backoff (≤3 retries). Auth failure / network / playlist errors all show a clear message and **reset the button — never a stuck spinner**.
- **`bands.json` is read-only; picks are read, not modified.** The export reads the existing `status` map; nothing about picks, scoring, schedule, the day filter, or Firebase sync changes.
- **SSR-safe + client-only.** All PKCE/crypto/token/window/`sessionStorage` code runs only in the browser. `SpotifyProvider` (in `layout.tsx`) is inert until mounted and renders nothing extra when unconfigured, so static prerender and the logged-out/not-connected experience are byte-for-byte unchanged.
- **Live OAuth round-trip + real playlist creation require a real allowlisted Spotify account** and a browser — they can't be driven headless and are **user-verified only**.
