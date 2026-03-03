/**
 * Database Module — Neon Serverless Postgres
 *
 * Handles palette persistence for the shareable link feature.
 * Uses @neondatabase/serverless which connects over HTTP (no TCP needed),
 * making it compatible with serverless/edge environments.
 *
 * Schema: see initDb() for the CREATE TABLE statement.
 */

import { neon } from '@neondatabase/serverless';
import { env } from '$env/dynamic/private';

/** Get a SQL tagged template function connected to our Neon database */
const sql = neon(env.DATABASE_URL || '');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SavedPalette {
	id: string;            // UUID used in the shareable URL
	artwork_id: number;    // Art Institute artwork numeric ID
	colors: string;        // JSON string of ExtractedColor[]
	mode: string;          // 'dominant' | 'vibrant'
	count: number;         // Number of colors (5-8)
	created_at: string;    // ISO timestamp
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Save a palette and return its UUID for the shareable link.
 */
export async function savePalette(palette: {
	id: string;
	artworkId: number;
	colors: object[];
	mode: string;
	count: number;
}): Promise<void> {
	await sql`
		INSERT INTO palettes (id, artwork_id, colors, mode, count)
		VALUES (${palette.id}, ${palette.artworkId}, ${JSON.stringify(palette.colors)}, ${palette.mode}, ${palette.count})
	`;
}

/**
 * Load a saved palette by its UUID.
 * Returns null if not found.
 */
export async function getPalette(id: string): Promise<SavedPalette | null> {
	const rows = await sql`
		SELECT * FROM palettes WHERE id = ${id}
	`;
	return (rows[0] as SavedPalette) ?? null;
}

/**
 * Initialize the database schema.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
export async function initDb(): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS palettes (
			id TEXT PRIMARY KEY,
			artwork_id INTEGER NOT NULL,
			colors JSONB NOT NULL,
			mode TEXT NOT NULL,
			count INTEGER NOT NULL,
			created_at TIMESTAMPTZ DEFAULT now()
		)
	`;
}
