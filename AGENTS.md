# AGENTS.md — aic-palette-gen

Chicago Art Institute Color Palette Generator.
Pulls artworks from the Art Institute of Chicago public API and generates color palettes.

**Spec:** See Obsidian note at `03_creating/art-institute-color-palette-generator/`

---

## Stack

- **Framework:** SvelteKit (Svelte 5, runes mode)
- **Styling:** Tailwind 4
- **Color extraction:** `node-vibrant` (vibrant mode), `quantize` + color-thief pattern (dominant mode)
- **Database:** Neon (serverless Postgres) — for palette UUID short links
- **API:** Art Institute of Chicago public API (`https://api.artic.edu/docs/`)
- **Deploy:** Vercel (planned)
- **No git remote yet** — local only

---

## Critical Rules

### Svelte 5 runes — always
- Use `$state`, `$derived`, `$effect`, `$props` — not legacy Options API
- Use `$app/state` for page store — NOT `$app/stores`
- No `export let` for props — use `let { prop } = $props()`

### Art Institute API
- Base URL: `https://api.artic.edu/api/v1`
- Images: `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`
- No API key required — public API
- Respect rate limits — don't hammer the API in dev

### Color Extraction Modes
- **Dominant:** Most frequent colors (color-thief pattern using `quantize`)
- **Vibrant:** Emotionally weighted algorithmic extraction via `node-vibrant`
- User can select mode and number of colors (min 5, max 8)
- AI mode is planned for later — do not implement yet

### Database (Neon)
- Used only for palette UUID → data lookups (short link sharing)
- Schema:
  ```sql
  CREATE TABLE palettes (
    id TEXT PRIMARY KEY,
    artwork_id TEXT NOT NULL,
    colors JSONB NOT NULL,
    mode TEXT NOT NULL,
    count INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
- No user auth — anonymous saves only

### UI Layout
- Art fills left ¾ of page
- Search/filter panel on right ¼
- Color palette swatches below the art, within the same container
- Minimal and clean aesthetic
- Random artwork shown on first load

### Export Formats
- `.ase` (Adobe Swatch Exchange)
- `.png` (swatch image)
- `.json`
- CSS variables (Figma-friendly)

### Git
- No remote configured yet
- Do NOT create a remote or push without explicit instruction from Jesse

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

```bash
npm run dev       # Dev server (uses npm, not pnpm)
npm run build     # Production build
npx svelte-check  # Type-check Svelte files
```
