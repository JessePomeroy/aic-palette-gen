/**
 * Palette Export Module
 *
 * Converts extracted color palettes into various downloadable formats:
 * - JSON:  Machine-readable, good for dev tools and custom integrations
 * - CSS:   Custom properties (variables) ready to paste into stylesheets
 * - PNG:   Visual swatch strip with hex labels — great for sharing
 * - ASE:   Adobe Swatch Exchange — imports directly into Photoshop/Illustrator
 *
 * All exports run client-side using Canvas (PNG) and ArrayBuffer (ASE).
 */

import type { ExtractedColor } from '../colors/extraction';

// ─── JSON Export ─────────────────────────────────────────────────────────────

/**
 * Export palette as formatted JSON.
 * Includes hex, RGB, and HSL for each color.
 */
export function exportJson(colors: ExtractedColor[]): string {
	return JSON.stringify({
		colors: colors.map(c => ({
			hex: c.hex,
			rgb: c.rgb,
			hsl: c.hsl,
			name: c.name
		}))
	}, null, 2);
}

// ─── CSS Export ──────────────────────────────────────────────────────────────

/**
 * Export palette as CSS custom properties (variables).
 *
 * Output example:
 *   :root {
 *     --color-1: #a83f2e;
 *     --color-1-rgb: 168, 63, 46;
 *   }
 *
 * The -rgb variant is useful for rgba() usage:
 *   background: rgba(var(--color-1-rgb), 0.5);
 *
 * @param prefix - Variable name prefix (default: "color")
 */
export function exportCss(colors: ExtractedColor[], prefix: string = 'color'): string {
	const lines = [':root {'];
	colors.forEach((c, i) => {
		lines.push(`  --${prefix}-${i + 1}: ${c.hex};`);
		lines.push(`  --${prefix}-${i + 1}-rgb: ${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b};`);
	});
	lines.push('}');
	return lines.join('\n');
}

// ─── PNG Export ──────────────────────────────────────────────────────────────

/**
 * Export palette as a PNG swatch strip.
 *
 * Renders each color as a vertical band with its hex code overlaid at the bottom.
 * White text with a dark shadow ensures readability on any color.
 *
 * @param width  - Total image width in pixels (default: 800)
 * @param height - Total image height in pixels (default: 200)
 */
export async function exportPng(colors: ExtractedColor[], width: number = 800, height: number = 200): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');

	if (!ctx) throw new Error('Could not get canvas context');

	const swatchWidth = width / colors.length;

	// Draw color bands
	colors.forEach((color, i) => {
		ctx.fillStyle = color.hex;
		ctx.fillRect(i * swatchWidth, 0, swatchWidth, height);
	});

	// Overlay hex labels with drop shadow for readability
	ctx.fillStyle = '#fff';
	ctx.font = '14px system-ui';
	ctx.textAlign = 'center';

	colors.forEach((color, i) => {
		const x = i * swatchWidth + swatchWidth / 2;
		const y = height - 20;

		ctx.shadowColor = 'rgba(0,0,0,0.5)';
		ctx.shadowBlur = 4;
		ctx.fillText(color.hex, x, y);
		ctx.shadowBlur = 0;
	});

	return new Promise((resolve, reject) => {
		canvas.toBlob(blob => {
			if (blob) resolve(blob);
			else reject(new Error('Failed to create PNG blob'));
		}, 'image/png');
	});
}

// ─── ASE Export ──────────────────────────────────────────────────────────────

/**
 * Export palette as Adobe Swatch Exchange (.ase) binary format.
 *
 * ASE is a binary format used by Photoshop, Illustrator, and InDesign for
 * importing color swatches. Each color is stored as a named block with
 * RGB float values (0.0–1.0).
 *
 * File structure:
 *   [4 bytes]  Signature: 'ASEF'
 *   [4 bytes]  Version: 1.0
 *   [4 bytes]  Number of blocks
 *   [blocks]   Color entries:
 *     [2 bytes]  Block type (0x0001 = color entry)
 *     [4 bytes]  Block length
 *     [2 bytes]  Name length (UTF-16 chars including null terminator)
 *     [n bytes]  Name in UTF-16BE
 *     [4 bytes]  Color space identifier ('RGB ')
 *     [12 bytes] 3x float32 color values (0.0–1.0)
 *     [2 bytes]  Color type (0=global, 1=spot, 2=normal)
 */
export function exportAse(colors: ExtractedColor[]): Blob {
	const numBlocks = colors.length;

	// Calculate total binary size needed
	let totalSize = 12; // 4 (sig) + 4 (version) + 4 (block count)
	colors.forEach(color => {
		const nameLen = 1 + color.hex.length; // hex string + null terminator
		// 2 (block type) + 4 (block len) + 2 (name len) + name*2 (UTF-16) + 4 (color space) + 12 (RGB floats) + 2 (color type)
		totalSize += 2 + 4 + 2 + nameLen * 2 + 4 + 12 + 2;
	});

	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);
	let offset = 0;

	// ── Header ──

	// Signature: 'ASEF'
	view.setUint8(offset++, 0x41); // A
	view.setUint8(offset++, 0x53); // S
	view.setUint8(offset++, 0x45); // E
	view.setUint8(offset++, 0x46); // F

	// Version 1.0
	view.setUint16(offset, 1, false); offset += 2;  // major
	view.setUint16(offset, 0, false); offset += 2;  // minor

	// Number of color blocks
	view.setUint32(offset, numBlocks, false); offset += 4;

	// ── Color Blocks ──

	colors.forEach(color => {
		const name = color.hex + '\0';  // Null-terminated name (we use the hex value)
		const nameLen = name.length;

		// Block type: 0x0001 = color entry
		view.setUint16(offset, 1, false); offset += 2;

		// Block length: everything after this 4-byte field
		const blockLen = 2 + nameLen * 2 + 4 + 12 + 2;
		view.setUint32(offset, blockLen, false); offset += 4;

		// Name length in UTF-16 characters (including null terminator)
		view.setUint16(offset, nameLen, false); offset += 2;

		// Name encoded as UTF-16 Big Endian
		for (let i = 0; i < name.length; i++) {
			view.setUint16(offset, name.charCodeAt(i), false); offset += 2;
		}

		// Color space: 'RGB ' (4 ASCII bytes)
		view.setUint8(offset++, 0x52); // R
		view.setUint8(offset++, 0x47); // G
		view.setUint8(offset++, 0x42); // B
		view.setUint8(offset++, 0x20); // (space)

		// RGB values as 32-bit floats, normalized to 0.0–1.0
		view.setFloat32(offset, color.rgb.r / 255, false); offset += 4;
		view.setFloat32(offset, color.rgb.g / 255, false); offset += 4;
		view.setFloat32(offset, color.rgb.b / 255, false); offset += 4;

		// Color type: 2 = normal (not spot or global)
		view.setUint16(offset, 2, false); offset += 2;
	});

	return new Blob([buffer], { type: 'application/octet-stream' });
}

// ─── Download Helper ─────────────────────────────────────────────────────────

/**
 * Trigger a browser file download for the given content.
 * Works with both text content (JSON, CSS) and binary blobs (PNG, ASE).
 */
export function downloadFile(content: string | Blob, filename: string): void {
	const blob = content instanceof Blob ? content : new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);

	// Create a temporary <a> element to trigger the download
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}
