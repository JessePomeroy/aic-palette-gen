/**
 * Initialize the Neon database schema.
 * Run with: npx tsx scripts/init-db.ts
 */

import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

const sql = neon(process.env.DATABASE_URL!);

async function main() {
	console.log('Creating palettes table...');
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
	console.log('Done!');
}

main().catch(console.error);
