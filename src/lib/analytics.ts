/**
 * Vercel Analytics
 * https://vercel.com/docs/concepts/analytics
 */
import { dev } from '$app/environment';

export function analytics() {
	if (dev) return; // Only load in production

	// Dynamically import to avoid SSR issues
	import('@vercel/analytics').then(({ inject }) => {
		inject();
	});
}
