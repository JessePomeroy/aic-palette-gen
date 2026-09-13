# API and persistence reference

[Documentation home](README.md) · [Architecture](architecture.md) · [Operations](operations.md)

This reference describes the repository's handlers, not a promise about a deployed API version. Examples contain no credentials. Commands that save palettes or generate Tone change state or may incur provider usage; do not use production for test writes without approval.

## Route inventory

| Method and route | Purpose | Response |
|---|---|---|
| `GET /` | Interactive workbench | SvelteKit page; browser loads initial artwork |
| `POST /api/palette` | Persist an explicit share action | UUID and absolute share URL |
| `GET /palette/[id]` | Display a saved palette | Server-loaded page, not a palette JSON endpoint |
| `POST /api/ai-palette?count=N` | Generate an interpretive Tone palette | Validated colors and description |
| `GET /api/image?url=...` | Same-origin museum-image fallback | Image response or an upstream/local error |
| `GET /color-index/<release>/...` | Read bundled index assets | Static JSON or raw canonical sample bytes |

There is no current account API, palette update/delete API, public full-scan trigger, custom-image import UI, or server endpoint for arbitrary color-index queries. Locked-color search runs in the browser.

## `POST /api/palette`

Source: [`+server.ts`](../src/routes/api/palette/+server.ts), [`palette-request.ts`](../src/lib/server/palette-request.ts), [`db/index.ts`](../src/lib/db/index.ts).

The body is JSON, bounded to **16 KiB** while streaming. A supplied `Origin` must match the request's site origin; `Sec-Fetch-Site: cross-site` is rejected. These checks address browser cross-site submissions, not authentication of all clients.

| Field | Contract |
|---|---|
| `artworkId` | Integer from 1 through 2,147,483,647 |
| `mode` | `dominant`, `vibrant`, or `ai` |
| `count` | Integer from 5 through 8 |
| `colors` | Array containing exactly `count` entries |
| `colors[].hex` | Six-digit `#RRGGBB`, case-insensitive |
| `colors[].rgb` | Integer `r`, `g`, `b`, each 0–255; values must agree with hex |
| `colors[].hsl` | Finite `h` 0–360, `s`/`l` 0–100 |
| `colors[].name` | Optional string, at most 80 characters |

Unknown fields are stripped when the request is normalized. HSL bounds are validated, but the route does not independently prove HSL/hex agreement, museum artwork existence, or that colors were extracted from that artwork. The database has no foreign key into a museum catalog table.

Example body:

```json
{
  "artworkId": 27992,
  "mode": "dominant",
  "count": 5,
  "colors": [
    { "hex": "#000000", "rgb": { "r": 0, "g": 0, "b": 0 }, "hsl": { "h": 0, "s": 0, "l": 0 } },
    { "hex": "#ffffff", "rgb": { "r": 255, "g": 255, "b": 255 }, "hsl": { "h": 0, "s": 0, "l": 100 } },
    { "hex": "#ff0000", "rgb": { "r": 255, "g": 0, "b": 0 }, "hsl": { "h": 0, "s": 100, "l": 50 } },
    { "hex": "#00ff00", "rgb": { "r": 0, "g": 255, "b": 0 }, "hsl": { "h": 120, "s": 100, "l": 50 } },
    { "hex": "#0000ff", "rgb": { "r": 0, "g": 0, "b": 255 }, "hsl": { "h": 240, "s": 100, "l": 50 } }
  ]
}
```

This is a schema example, not a claim that these five colors describe artwork 27992.

Success is HTTP 201 with `{ "id": "<uuid>", "url": "<request-origin>/palette/<uuid>" }`. Each accepted save creates a new UUID; identical submissions are not server-side deduplicated and there is no idempotency-key contract.

| Status | Meaning |
|---|---|
| 400 | Malformed JSON or invalid palette values/shape |
| 403 | Rejected cross-site browser request |
| 413 | Request exceeds the body cap |
| 415 | Content type is not JSON |
| 429 | Best-effort burst limit reached; includes `Retry-After` |
| 503 | Persistence unavailable; friendly error and `Retry-After: 30` |

The save limiter allows 10 requests per client address and 100 total per instance in a fixed 60-second window. It runs before body validation, so invalid attempts can consume that budget. Error responses do not expose database exception details.

## Saved-palette schema

The implemented initialization schema is:

```sql
CREATE TABLE IF NOT EXISTS palettes (
  id TEXT PRIMARY KEY,
  artwork_id INTEGER NOT NULL,
  colors JSONB NOT NULL,
  mode TEXT NOT NULL,
  count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

`id` contains a generated UUID but is stored as text. Colors are a JSONB array of normalized color objects. The application handles driver results arriving as parsed JSON or as a JSON string. Mode may be `ai`, even where an older code comment lists only dominant/vibrant.

The database does not contain full museum metadata, images, signatures, workbench locks, recent history, or the Tone description. Its SQL schema has no enum/check constraints corresponding to all route validations; callers bypassing the route need to uphold those invariants themselves. `IF NOT EXISTS` is initialization, not a migration or a repair for a differently shaped existing table.

## `GET /palette/[id]`

Source: [`+page.server.ts`](../src/routes/palette/[id]/+page.server.ts) and [`+page.svelte`](../src/routes/palette/[id]/+page.svelte).

The server rejects a malformed UUID with 404 before querying Neon, returns 404 for a missing record, and returns a friendly 503 if the database is unavailable. It then fetches artwork details from the museum using the saved numeric artwork ID.

The page displays the saved palette and offers ordinary palette exports. It does not re-run extraction or regenerate Tone. It does not restore the main workbench's locks or a saved tone description because those fields are not in the shared-palette schema. Artwork presentation still depends on external museum metadata and image access.

Share links are public bearer links: anyone possessing one can view it. The application has no user ownership/authentication or deletion endpoint. Do not describe them as private or revocable links.

## `POST /api/ai-palette?count=N`

Source: [`+server.ts`](../src/routes/api/ai-palette/+server.ts), [`tone-image.ts`](../src/lib/server/tone-image.ts), [`tone-response.ts`](../src/lib/server/tone-response.ts).

Send **JPEG bytes**, not JSON containing a URL. The requested count must be 5–8; if omitted, the handler defaults to 6. The UI passes its selected count explicitly. Upload validation checks JPEG content type, signature, and a streamed maximum of **1 MiB**. It is not a general untrusted-image processing platform or a semantic proof of the uploaded subject.

The route rejects foreign browser origins, applies limits of 3 requests per client and 20 per instance per 60 seconds, and requires private `GEMINI_API_KEY` configuration. It sends one request to the configured `gemini-2.5-flash-lite:generateContent` endpoint with JSON output requested and a 1,024-output-token setting. Credentials are in a server-to-provider header; provider exception bodies are not exposed to the client.

The provider request combines the incoming request signal with a 30-second timeout. The route's configured maximum function duration is 45 seconds. These are different limits. The browser may make separate user-requested Tone actions, but the handler itself does not automatically retry a provider call.

Success returns `{ "description": "...", "colors": [...] }` with normalized color objects. Interpretation can suggest colors absent from the literal image. Named colors and descriptions are display content, not an input to the art index.

| Status | Meaning |
|---|---|
| 400 | Invalid count or JPEG input |
| 403 | Rejected cross-site browser request |
| 429 | Local or provider rate limit; includes retry guidance |
| 502 | Provider failure or unusable/incomplete output |
| 503 | Missing local/server provider configuration |
| 504 | Provider/request timeout or cancellation seen through the combined signal |

Tone does not save a share link automatically. A later explicit Share action is a separate persistence request.

## `GET /api/image`

Source: [`image/+server.ts`](../src/routes/api/image/+server.ts).

The `url` parameter must parse as HTTPS, have hostname exactly `www.artic.edu`, no credentials or explicit non-default port, and a pathname under `/iiif/2/`. Redirects are rejected. This is not an arbitrary open URL proxy.

Valid upstream image responses stream back with their image content type and a public 24-hour cache-control value. An invalid input returns 400; upstream unsuccessful statuses are preserved; fetch failures and successful non-image responses produce 502. The handler supplies the museum-facing image headers used by the project.

Do not confuse this proxy with the bounded offline downloader. The proxy currently has no explicit upstream byte cap or its own server-side timeout in this handler. Its cache policy is a response instruction, not evidence that every host/browser has cached the image.

## Static assets and compatibility

The active runtime directory contains `index.json`, `artworks.json`, `report.json`, and `samples/<sha256>.rgba`. Samples are immutable raw pixel data; no image decoder is required to verify them. Index v1 is rejected by the v2 reader because it lacks the canonical-sample contract.

The full scan's `.rgba.gz` staging files are not interchangeable URLs for this runtime. A future release must preserve matching IDs, descriptors, file lengths, digests, and policy compatibility as one coherent asset set.
