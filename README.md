# aic-palette-gen

A web app that extracts color palettes from artworks in the [Art Institute of Chicago](https://www.artic.edu/) collection.

Browse, search, or randomize through 130k+ artworks and generate downloadable color palettes for your creative projects.

## Features

- **Search & Random** — find artworks by keyword or discover random pieces
- **Color Extraction** — dominant (by brightness) and vibrant (by saturation) modes
- **Adjustable Palette** — 5 to 8 colors per palette
- **Export** — JSON, CSS variables, PNG swatch strip, Adobe .ASE
- **Shareable Links** — save palettes to a database and share via short URL

## Stack

- [SvelteKit](https://svelte.dev/) + [Tailwind 4](https://tailwindcss.com/)
- [Art Institute of Chicago API](https://api.artic.edu/docs/) (public, no auth)
- Canvas API + k-means clustering for color extraction
- [Neon](https://neon.tech/) (serverless Postgres) for shareable palette links

## Setup

```bash
# install dependencies
npm install

# set up environment
cp .env.example .env
# add your Neon DATABASE_URL to .env

# initialize the database
npx tsx scripts/init-db.ts

# start dev server
npm run dev
```

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |

## License

MIT
