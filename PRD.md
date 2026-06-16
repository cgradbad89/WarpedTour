# PRD.md — Warped Tour Long Beach 2026 Band Explorer

## 1. Overview

A single-user, static web app that helps me prep for **Vans Warped Tour — Long Beach 2026** (July 25–26, Shoreline Waterfront) by browsing all ~141 bands ranked by how likely I am to enjoy them, based on my Spotify listening data.

**Core value:** open the app, see which bands to prioritize, listen to a 30-second preview, mark a personal must-see / maybe / skip, and jump to the artist on Spotify.

**Scope for this build (MVP):**
- Single user (me). No auth, no accounts, no backend.
- All band data is pre-computed and shipped as a static `bands.json` (already built — do not regenerate as part of app work; see Section 8 for the refresh script).
- Personal must-see/maybe/skip state persists in **browser localStorage** only (no Firestore, no cross-device sync — this is intentional).

**Explicitly out of scope for MVP** (see Section 7 backlog): multi-user Spotify OAuth, live Spotify playback (full tracks), set-times / stage assignments, cross-device sync.

## 2. Page Inventory

| Route | Purpose | Notes |
|---|---|---|
| `/` | Main list/explorer view | Search, filter, sort, band rows. Default landing. |
| `/band/[slug]` OR modal | Band detail view | May be implemented as a route or an in-page modal/drawer — implementer's choice. Detail content per Section 5. |

This is a small app. A single-page approach with a detail modal is acceptable and probably preferable to a second route. If using a route, derive `slug` from the band name (slugify; names are unique in the dataset).

## 3. Data Model

There is **no database**. The entire data layer is one static file: `public/bands.json` (≈184 KB, 141 bands).

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

The must-see/maybe/skip toggle is the only user-writable state.

- **Storage key:** `warped2026:status` (single key, JSON object).
- **Shape:** `{ [bandName: string]: "must" | "maybe" | "skip" }`. Absence = unset.
- **Why keyed by name:** band names are unique and stable in the dataset; this survives `bands.json` refreshes without an id migration.
- **Write:** on toggle, read the object, set/clear the band's key, write back. Clearing (toggling off) removes the key.
- **Read:** load once on mount into app state; keep localStorage and in-memory state in sync.
- **Reset:** provide a small "Clear my picks" affordance (e.g. in a header menu) that empties the key after a confirm.

Do **not** use `localStorage` for anything else. No analytics, no caching of `bands.json` (it ships with the app).

## 5. UI Requirements

Reference mockup behavior was approved in chat. Build to this:

### 5.1 List view (`/`)
- **Header:** event name + dates + venue, and a live count of visible bands.
- **Controls row:**
  - Search input — filters by `name` (case-insensitive substring). Live/onChange.
  - Genre filter — `<select>` populated from `all_genres`; "All genres" default. A band matches if the selected genre is in its `genres` array.
  - Sort `<select>`: **Match (high→low)** [default], Name (A–Z), Genre. Match sort ties broken by `fans` desc.
  - Optional: a status filter (All / Must see / Maybe / Skip / Unset) reading localStorage — nice-to-have, not required for MVP.
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
- **Status toggle:** three-state control (Must see / Maybe / Skip) writing to localStorage per Section 4. Reflect current state; allow clearing.

### 5.3 Design
- Follow the repo's `frontend-design` conventions if present. Otherwise: clean, flat, mobile-first (this gets used on a phone at the festival). Tailwind. No heavy chrome.
- **Mobile is the priority target** — I'll use this on my phone on-site. Tap targets ≥44px, fast, works one-handed.

## 6. Known Sharp Edges

- **`bands.json` is read-only at runtime.** Never write to it. Personal state is localStorage only. The `user_status` field inside the JSON is a frozen `null` and must be ignored.
- **Similar-artist data is from Deezer, not Spotify.** Spotify deprecated its Related Artists / Recommendations / Audio Features endpoints for new apps (Nov 2024), so none of those can be called from a new Spotify app. Don't try to "upgrade" similar-artists by calling Spotify — it will 403.
- **Spotify links are search URLs, not artist-ID deep links.** `spotify:search:<name>` opens the app to a search, not directly to the artist page. This is a deliberate MVP tradeoff (no Spotify API access at build time). Exact deep-linking is a backlog item (Section 7).
- **A few genre tags are imperfect.** MusicBrainz tagging is crowd-sourced; e.g. a band may carry a broad/odd parent genre. The data is good enough for filtering; don't hand-tune inside the app.
- **`preview_url` can be empty** for 1 band (140/141 have previews). Always guard the player.
- **The lineup was the near-final March reveal.** ~8 slots were unannounced at data-build time. The app must render whatever is in `bands.json` and not assume a fixed count. When the final bands drop, regenerate via the refresh script (Section 8) — don't hardcode additions.
- **`preview_url` is HTTP-served from Deezer's CDN.** Ensure the audio element loads over HTTPS (the URLs are https); no mixed-content.
- **Band names contain punctuation** (`The Academy Is...`, `Drop Dead, Gorgeous`, `Letlive.`, `Bear Vs. Shark`). Slugify defensively if using routes; prefer matching by exact `name`.

## 7. Feature Backlog

- [ ] **Spotify artist deep-links** — resolve each band to a Spotify artist ID (via Spotify search API during the data-refresh step, server-side) and store `spotify_uri`/`spotify_url` so links open the artist page directly instead of a search.
- [ ] **Set-times / stage view** — once Warped publishes the schedule, add day/stage fields and a "by time slot" view to plan conflicts.
- [ ] **Status filter** in the list view (All / Must / Maybe / Skip / Unset).
- [ ] **Multi-user mode** — Spotify OAuth (`user-top-read`) so others can connect and get their own scores. Requires moving scoring into a runtime/server step and a backend. Large; deferred by design.
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

`bands.json` was generated against my Spotify export covering three windows (lifetime / 6-month / 1-month top artists + genres). Similar artists: Deezer. Genre tags + origin: MusicBrainz. Previews: Deezer CDN. Event: 141 bands, July 25–26 2026, Shoreline Waterfront, Long Beach. Buckets: In your rotation (25) · Must see (27) · High match (30) · Long shot (33) · Discovery (26).
