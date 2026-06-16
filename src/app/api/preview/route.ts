// GET /api/preview?id=<deezer_id>  →  { preview: string | null }
//
// Resolves a FRESH 30-second preview URL for a band at play time (PRD §5.2, §6).
// The preview_url baked into bands.json is a time-limited Deezer signed CDN link
// (hdnea=exp=<unix>) that expires within ~a day, so it can't be the play source.
// We re-resolve from the band's deezer_id via Deezer's public, keyless API.
//
// Why a route at all: Deezer's api.deezer.com does NOT send an
// Access-Control-Allow-Origin header, so a direct browser fetch is CORS-blocked
// (verified). This server-side hop is the ONLY runtime backend in the app — it's
// keyless, holds no secrets, and does nothing but read data[0].preview.

export const dynamic = "force-dynamic"; // never cache at build; preview URLs are short-lived

const DEEZER_TIMEOUT_MS = 8000;

export async function GET(request: Request): Promise<Response> {
  const idRaw = new URL(request.url).searchParams.get("id");
  const id = Number(idRaw);
  if (!idRaw || !Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "Invalid or missing Deezer id." }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.deezer.com/artist/${id}/top?limit=1`, {
      headers: { "User-Agent": "WarpedTourBandExplorer/1.0 (preview-resolver)" },
      signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json(
        { preview: null, error: `Deezer HTTP ${res.status}` },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    const data: unknown = await res.json();
    const top = (data as { data?: Array<{ preview?: unknown }> })?.data?.[0];
    const preview = typeof top?.preview === "string" && top.preview ? top.preview : null;
    return Response.json({ preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return Response.json(
      { preview: null, error: message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
