import type { ExtractedColor } from "./extraction";

/** Locked colors retain their positions; candidates fill only the remaining slots. */
export function applyLocks(
	candidates: ExtractedColor[],
	locks: (ExtractedColor | null)[],
	count: number,
): ExtractedColor[] {
	const used = new Set(
		locks.slice(0, count).flatMap((c) => (c ? [c.hex.toLowerCase()] : [])),
	);
	const available = candidates.filter((c) => !used.has(c.hex.toLowerCase()));
	let next = 0;
	return Array.from({ length: count }, (_, i) => {
		const locked = locks[i];
		if (locked) return locked;
		const color = available[next++] ?? candidates[i % candidates.length];
		return color;
	}).filter((color): color is ExtractedColor => Boolean(color));
}

export function contrastRatio(a: string, b: string): number {
	const luminance = (hex: string) => {
		const channels = [1, 3, 5].map((i) => {
			const value = parseInt(hex.slice(i, i + 2), 16) / 255;
			return value <= 0.04045
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4;
		});
		return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
	};
	const x = luminance(a),
		y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function readableText(background: string): string {
	return contrastRatio(background, "#000000") >=
		contrastRatio(background, "#ffffff")
		? "#000000"
		: "#ffffff";
}

/** Suggest the closest blend toward black or white that meets normal-text AA. */
export function suggestTextColor(text: string, background: string): string {
	if (contrastRatio(text, background) >= 4.5) return text;
	const target = readableText(background) === "#000000" ? 0 : 255;
	for (let step = 1; step <= 100; step++) {
		const hex =
			"#" +
			[1, 3, 5]
				.map((i) => {
					const channel = parseInt(text.slice(i, i + 2), 16);
					return Math.round(channel + ((target - channel) * step) / 100)
						.toString(16)
						.padStart(2, "0");
				})
				.join("");
		if (contrastRatio(hex, background) >= 4.5) return hex;
	}
	return readableText(background);
}
