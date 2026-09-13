/** Best-effort per-instance burst protection, not a distributed quota.
 * Deployment-wide protection belongs at the hosting firewall. Entries expire
 * after one minute and the global limit also bounds this map's growth.
 */
export function createWriteLimiter(perClient: number, perInstance: number) {
	const clients = new Map<string, number>();
	let windowEnd = 0;
	let total = 0;
	return (client: string, now = Date.now()): number => {
		if (now >= windowEnd) {
			clients.clear();
			total = 0;
			windowEnd = now + 60_000;
		}
		const count = clients.get(client) ?? 0;
		if (count >= perClient || total >= perInstance)
			return Math.max(1, Math.ceil((windowEnd - now) / 1000));
		clients.set(client, count + 1);
		total++;
		return 0;
	};
}
