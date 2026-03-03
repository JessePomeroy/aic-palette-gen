/**
 * Vercel Analytics
 * https://vercel.com/docs/concepts/analytics
 */
import { dev } from '$app/environment';
import { injectAnalytics } from '@vercel/analytics/sveltekit';

export function analytics() {
	if (dev) return; // Only load in production
	injectAnalytics();
}
