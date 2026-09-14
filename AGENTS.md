# AGENTS.md — aic-palette-gen

Chicago Art Institute Color Palette Generator.
Pulls artworks from the Art Institute of Chicago public API and generates color palettes.

**Spec:** See Obsidian note at `03_creating/art-institute-color-palette-generator/`

---

## Stack

- **Framework:** SvelteKit (Svelte 5, runes mode)
- **Styling:** Tailwind 4
- **Color extraction:** browser Canvas/k-means for Dominant/Vibrant; `node-vibrant/node` for offline canonical samples
- **Database:** Neon (serverless Postgres) — for palette UUID short links
- **API:** Art Institute of Chicago public API (`https://api.artic.edu/docs/`)
- **Deploy:** Vercel at https://www.chromacollection.online
- **Index:** 59,025 audited artworks in a dedicated Cloudflare R2 bucket, served through a read-only Worker
- **Remote:** https://github.com/JessePomeroy/aic-palette-gen (primary branch `main`)
- **Documentation:** `docs/README.md`; dated deployment evidence in `docs/release-checklist.md`

---

## Critical Rules

### Svelte 5 runes — always
- Use `$state`, `$derived`, `$effect`, `$props` — not legacy Options API
- Use `$app/state` for page store — NOT `$app/stores`
- No `export let` for props — use `let { prop } = $props()`

### Art Institute API
- Base URL: `https://api.artic.edu/api/v1`
- Images: use `getImageUrl` from the museum client; ordinary large images request 843px, narrower originals use bounded derivatives
- No API key required — public API
- Respect rate limits — don't hammer the API in dev

### Color Extraction Modes
- **Dominant/Vibrant:** shared browser k-means, sorted by lightness/saturation respectively
- User can select mode and number of colors (min 5, max 8)
- **Tone:** explicitly requested server-side Gemini interpretation; never call a paid provider automatically during verification
- Indexed matching is separate: preserve canonical pixels, strict all-lock acceptance, cancellation, and distinct incomplete/no-match outcomes

### Database (Neon)
- Used only for palette UUID → data lookups (short link sharing)
- Schema:
  ```sql
  CREATE TABLE palettes (
    id TEXT PRIMARY KEY,
    artwork_id INTEGER NOT NULL,
    colors JSONB NOT NULL,
    mode TEXT NOT NULL,
    count INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- No user auth — anonymous saves only

### UI Layout
- Artwork-first desktop/mobile workbench with swatches below the artwork
- Shared native dialog: desktop drawer and mobile bottom sheet with pull-down dismissal
- Classic and Card export previews; keep locks and user selections across artwork changes
- Random artwork shown on first load

### Export Formats
- `.ase` (Adobe Swatch Exchange)
- `.png` (swatch image)
- `.json`
- CSS variables (Figma-friendly)

### Git
- Commit, push, PR creation, merge, and deployment each require user authority
- Use feature branches and review PR checks before merging; never force-push or push directly to `main` without explicit permission
- Keep local audit reports, credentials, original images and scan staging out of Git

---

## API Examples

```js
// Search artworks
GET https://api.artic.edu/api/v1/artworks/search?q=monet&fields=id,title,image_id,artist_title

// Random artworks
GET https://api.artic.edu/api/v1/artworks?fields=id,title,image_id,artist_title&limit=10&page=1

// Image URL
https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg
```

---

## Commands

```fish
npm run dev      # Start only when implementation/verification requires it; record the PID
npm run build    # Production build
npm run check    # Svelte/TypeScript checks
npm test         # Offline/fixture-based Node suite
```

Both lockfiles currently exist. Use established commands without regenerating dependencies casually. See `docs/operations.md` for scan, packaging, upload, deployment, and rollback procedures. Full-scan publication and original-image cleanup are separate operations; never delete originals as part of deployment.
