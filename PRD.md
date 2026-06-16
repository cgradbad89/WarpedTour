# PRD.md — Warped Tour Long Beach 2026 Band Explorer

## 1. Overview

A single-user, static web app that helps me prep for **Vans Warped Tour — Long Beach 2026** (July 25–26, Shoreline Waterfront) by browsing all ~149 bands ranked by how likely I am to enjoy them, based on my Spotify listening data.

**Core value:** open the app, see which bands to prioritize, listen to a 30-second preview, mark a personal must-see / maybe / look-into / skip, and jump to the artist on Spotify.

**Scope for this build (MVP):**
- Owner-first, but **shareable**: by default the app shows the owner's pre-computed scores; a friend can upload their own Spotify taste CSV to **re-score every band live in their own browser** (Section 10). Still no auth, no accounts, no backend — the re-score is 100% client-side.
- All band data is pre-computed and shipped as a static `bands.json` (already built — do not regenerate as part of app work; see Section 8 for the refresh script). The uploaded-taste feature **reuses** `bands.json` as the catalog and recomputes only the taste-dependent fields (Section 10) — it never modifies `bands.json`.
- Personal must-see/maybe/skip state persists in **browser localStorage** only (no Firestore, no cross-device sync — this is intentional). The uploaded profile is a separate localStorage key and never touches picks.

**Explicitly out of scope for MVP** (see Section 7 backlog): full multi-user Spotify **OAuth** (the upload feature is the lightweight, no-backend alternative — Section 10), live Spotify playback (full tracks), set-times / stage assignments, cross-device sync.

## 2. Page Inventory

| Route | Purpose | Notes |
|---|---|---|
| `/` | Main list/explorer view | Search, filter, sort, band rows, plus a "show only my picks" toggle. Default landing. |
| `/picks` | My Picks view | Real route. The bands you've marked, grouped by status (Must see / Maybe / Look into / Skip), with per-section reorder (drag + up/down-arrow fallback) and status-visibility toggles. |
| (in-page modal) | Band detail view | **Implemented as an in-page modal/drawer, not a route.** Chosen over `/band/[slug]` to avoid slug/punctuation issues (band names contain `.`, `,`, `...`). Opened from both `/` and `/picks`. Detail content per Section 5. |

Two routes (`/` and `/picks`), connected by a header tab on both pages; the detail view is an in-page modal opened from either — there is **no `/band` route**. Rows, personal state, and the saved pick order are all keyed by exact band `name` (unique in the dataset), so no slugification is needed and a `bands.json` refresh never orphans them.

## 3. Data Model

There is **no database**. The entire data layer is one static file: `public/bands.json` (≈195 KB, 149 bands).

### 3.1 Top-level shape

```json
{
  "event": { "name", "dates", "venue", "band_count" },
  "scoring": { "windows": [...], "method": "...", "note": "..." },
  "all_genres": ["alternative","emo","metal", ...],   // 13 filterable parents
  "buckets": ["In your rotation","Must see","High match","Long shot","Discovery"],
  "bands": [ Band, ... ]
}
```

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
| `preview_url` | string | 30-sec MP3 preview (Deezer CDN). Empty string if none (1 band). | `<audio>` source |
| `album` | string | Album of the top track | Player subtitle (optional) |
| `image` | string | Artist image URL (Deezer CDN, 250px) | Avatar |
| `fans` | number | Deezer fan count | Secondary sort / tie-break |
| `deezer_id` | number\|null | Deezer artist id | Future use |
| `spotify_search_uri` | string | `spotify:search:<name>` — opens Spotify **app** | "Open in Spotify" primary |
| `spotify_web_url` | string | `https://open.spotify.com/search/<name>` — browser fallback | "Open in Spotify" fallback |
| `user_status` | null | Placeholder. **Do not read/write this field.** Personal status lives in localStorage (Section 4). | — |

**Important:** `user_status` in the JSON is always `null` and is a frozen artifact of the data build. The app must NOT mutate `bands.json`. All personal state is localStorage-only.

## 4. Personal State (localStorage)

Two localStorage keys hold all user-writable state. The app NEVER writes `bands.json`.

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
  - A **"show only my picks"** toggle — when on, shows only bands with any saved status; composes with search/genre/sort and the live count. (Implemented; supersedes the old optional status-filter idea. Full per-status browsing lives on `/picks`, §5.4.)
- **Rows:** each band row shows avatar (`image`, fallback to initials), `name`, genre line (`genres` joined), a star rendering of `score`, a colored score chip, and the user's status marker if set. Click/tap opens detail.
  - **Score chip color:** ≥4.5 green, 3.5–4.0 amber, <3.5 neutral/gray. (Match the buckets, not arbitrary cutoffs — `In your rotation`/`Must see` = green, `High match` = amber, rest = gray.)
- **Grouping (optional but recommended):** group rows under `bucket` headers when sorted by Match. When sorted by Name/Genre, flat list.

### 5.2 Detail view (modal or route)
- Header: avatar, `name`, `genres` as pills, and the score block (number + stars + bucket label).
- `why` line under the score.
- `bio` paragraph.
- **Preview player:** an `<audio>` element using `preview_url`. Custom play/pause button is fine. Show `top_track` (and `album`) as the label. If `preview_url` is empty, hide the player and show "No preview available."
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
- **Reorder within a section:** drag the grip handle (Pointer Events — works with touch and mouse) or use the per-row up/down arrows (the touch-reliable fallback). Order persists to `warped2026:order` (§4.2). A per-section "Reset to score order" reverts to match-score order.
- Rows reuse the list-view `BandRow` look and open the **same** detail modal (§5.2).
- Empty states: a section with no bands shows "Nothing marked [status] yet"; with no picks at all, a friendly hint to mark bands on the Lineup.

## 6. Known Sharp Edges

- **`bands.json` is read-only at runtime.** Never write to it. Personal state is localStorage only. The `user_status` field inside the JSON is a frozen `null` and must be ignored.
- **Similar-artist data is from Deezer, not Spotify.** Spotify deprecated its Related Artists / Recommendations / Audio Features endpoints for new apps (Nov 2024), so none of those can be called from a new Spotify app. Don't try to "upgrade" similar-artists by calling Spotify — it will 403.
- **Spotify links are search URLs, not artist-ID deep links.** `spotify:search:<name>` opens the app to a search, not directly to the artist page. This is a deliberate MVP tradeoff (no Spotify API access at build time). Exact deep-linking is a backlog item (Section 7).
- **A few genre tags are imperfect.** MusicBrainz tagging is crowd-sourced; e.g. a band may carry a broad/odd parent genre. The data is good enough for filtering; don't hand-tune inside the app.
- **`preview_url` can be empty** for 1 band (148/149 have previews). Always guard the player.
- **The lineup was the near-final March reveal.** ~8 slots were unannounced at data-build time. The app must render whatever is in `bands.json` and not assume a fixed count. When the final bands drop, regenerate via the refresh script (Section 8) — don't hardcode additions.
- **`preview_url` is HTTP-served from Deezer's CDN.** Ensure the audio element loads over HTTPS (the URLs are https); no mixed-content.
- **Band names contain punctuation** (`The Academy Is...`, `Drop Dead, Gorgeous`, `Letlive.`, `Bear Vs. Shark`). Slugify defensively if using routes; prefer matching by exact `name`.
- **Status colors are rose / sky-blue / yellow / zinc** (must / maybe / look / skip) — *not* the green/amber the score chip uses. "Maybe" is sky-blue, so the yellow "Look into" is already clearly distinct from it (no amber-vs-yellow clash on the toggle). The one place yellow sits near amber is a list row, where the gold stars and an amber score chip share space with a yellow "Look" badge — they're kept apart by position and by using a brighter lemon-yellow (`yellow-400`) for status vs amber for score. When adding a fifth status, re-check this on a real row.
- **The favicon is generated, not hand-drawn.** `scripts/gen-favicon.mjs` is the single source of truth for the guitar shape and emits both `src/app/icon.svg` (primary, Next 16 file convention) and `src/app/favicon.ico` (3-size PNG-in-ICO fallback). Edit the geometry in that script and re-run `node scripts/gen-favicon.mjs`, then commit both outputs — don't hand-edit `favicon.ico`. Next auto-wires both via the App-Router file convention (no `metadata.icons` needed); a stray `favicon.ico` plus an `icon.svg` is the intended setup.
- **Adding a status is backward-compatible by construction.** The status validator keys off `STATUSES` (a superset after each addition), so old localStorage survives. Removing or renaming a status is *not* safe the same way — stored values for the dropped key would be silently discarded on load.
- **Re-scored "similar artists you listen to" is bounded by `bands.json`.** On an uploaded-profile re-score (Section 10), the only matching material is each band's stored `similar_general` ∪ `similar_you_listen` (a truncated reconstruction of the original Deezer related list) and `raw_tags`. Some bands have thin similar lists, so a friend's "similar" matches can be under-counted. **Direct artist matches are exact**; similar/genre matches are best-effort. This is disclosed in the upload dialog and the detail modal — don't oversell it.
- **The re-score algorithm lives in two places by design.** `scripts/refresh-data.mjs` bakes the owner's `bands.json` offline; `src/lib/scoring.ts` is a faithful TypeScript **port** that re-scores live in the browser. They are intentionally two copies of one algorithm — change one, mirror the other (and update `scoring.ts`'s tests). `direct-life` scores **4.5** (→ "Must see"), matching the generator, not 4.4.
- **`normalizeArtist` is looser than the generator's match.** The re-score matches artist names with diacritics folded and all non-alphanumerics stripped (so "Panic! At The Disco" ↔ "panic at the disco"). It's applied symmetrically and only on the re-score path; the default owner view reads `bands.json` verbatim, so it's unaffected.

## 7. Feature Backlog

- [ ] **Spotify artist deep-links** — resolve each band to a Spotify artist ID (via Spotify search API during the data-refresh step, server-side) and store `spotify_uri`/`spotify_url` so links open the artist page directly instead of a search.
- [ ] **Set-times / stage view** — once Warped publishes the schedule, add day/stage fields and a "by time slot" view to plan conflicts.
- [x] **Status filter / My Picks** — DONE: `/picks` page (bands grouped by status, reorderable with drag + arrows) plus a "show only my picks" toggle on `/`. See §2, §4.2, §5.4.
- [x] **Friend sharing / multi-user (lightweight)** — DONE: a friend uploads their Spotify taste **CSV** and the app re-scores every band live in their browser, fully client-side (Section 10, `warped2026:profile`). No backend, no OAuth.
- [ ] **Multi-user mode (full OAuth)** — Spotify OAuth (`user-top-read`) so others connect without exporting a CSV, and scores sync. Requires a runtime/server step and a backend. Still deferred by design; the upload feature above covers the no-backend case.
- [ ] **Cross-device sync** of personal picks (would need a backend; localStorage is MVP).
- [ ] **"Surprise me"** — highlight high-score bands I haven't marked yet.

## 8. External Services & Data Refresh

The app itself calls **no external services at runtime** — it's fully static. All enrichment happens offline in the data-refresh script, which is committed to the repo at `scripts/refresh-data.mjs` (or `.py`).

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
1. **Upload** (`ProfileBar` → `UploadProfileModal`): the friend picks/drops a `.csv`.
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
- No backend, no runtime network/API calls. `bands.json` is read-only and never re-saved.
- Re-scored "similar artists you listen to" is bounded by each band's stored similar lists (some are thin) — disclosed in-UI; direct matches are exact (see §6).
- All file/localStorage/parsing is client-only (SSR-guarded).
- The default no-profile experience is unchanged.

### 10.6 Tests
`npm test` runs dependency-free `node --test` suites (Node ≥ 22 native TS) under `tests/`: the CSV tokenizer, the taste-CSV parser (incl. shuffled groups, sub-header stripping, positional fallback, malformed-input errors), and the scoring port (tier/bucket snapping, `similar_you_listen` recompute, bio handling, and a real-`bands.json` check that no-profile is unchanged and a re-score doesn't mutate the baked file). A test-only resolution hook (`tests/ts-resolve.mjs`) lets Node resolve the app's `@/…` and extensionless imports; `tests/` is excluded from the Next build's type-check.
