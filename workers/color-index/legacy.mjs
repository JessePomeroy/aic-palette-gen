// Exact immutable releases only: never expose arbitrary bucket prefixes or originals.
export const LEGACY_RELEASES = [
	"starter-20260912",
	"expanded-20260912",
	"expanded-2500-20260913",
];
export const LEGACY_FILE =
	/^(?:index\.json|artworks\.json|report\.json|samples\/[a-f0-9]{64}\.rgba)$/;
export const LEGACY_ASSET = new RegExp(
	`^/v2/(?:${LEGACY_RELEASES.join("|")})/(?:${LEGACY_FILE.source.slice(1, -1)})$`,
);
