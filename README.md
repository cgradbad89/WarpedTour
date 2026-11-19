This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Personal "play my playlist" endpoint (Apple Watch Shortcut)

`POST /api/play` starts one fixed Spotify playlist on your iPhone's Spotify app (Premium required). Single user; no database. Details: PRD §14.

**Setup order**

1. **Generate a secret:** `openssl rand -hex 32` → set `PLAY_SECRET` in Vercel.
2. **Get the playlist URI:** in Spotify, playlist ⋯ → Share → *Copy link to playlist* (hold Option on desktop for the `spotify:playlist:…` URI form). Either form works. Set `SPOTIFY_PLAYLIST_URI`. Optionally set `SPOTIFY_DEVICE_NAME` (e.g. `iPhone`) and `SPOTIFY_SHUFFLE=true`.
3. **Make sure `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` is set in Vercel** (same client id the export feature uses; no client secret is needed — this uses PKCE).
4. **Spotify dashboard:** add the Redirect URI `https://<your-production-domain>/api/spotify/owner-callback` (exact match, https) to the app's settings. Your account must be the app owner (or an allowlisted user) and on Premium.
5. **Deploy**, then visit `https://<your-production-domain>/api/spotify/owner-auth?key=<PLAY_SECRET>` once. Approve the consent screen; the callback page shows the refresh token **once** plus a live "Player API check". Paste the token into Vercel as `SPOTIFY_OWNER_REFRESH_TOKEN` and redeploy.
6. **Test:**
   ```bash
   curl -X POST https://<your-production-domain>/api/play -H "x-play-secret: $PLAY_SECRET"
   ```
   Open Spotify on your iPhone first (a phone that hasn't run Spotify recently isn't listed as a device).
7. **Shortcut:** *Get Contents of URL* → URL above, Method `POST`, Header `x-play-secret: <secret>` → *Show Result* (the JSON `message`). Add it to the Watch.

Spotify refresh tokens expire after ~6 months; if `/api/play` says "Refresh token invalid — re-run owner auth", repeat step 5.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
