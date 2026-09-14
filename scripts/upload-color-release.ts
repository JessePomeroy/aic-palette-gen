import { createHash } from "node:crypto";
import { appendFile, lstat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

// Operator-only uploader. Credentials remain in memory; only verified object receipts are saved.
const { values } = parseArgs({
	options: {
		assets: { type: "string" },
		account: { type: "string" },
		prefix: { type: "string" },
		"token-file": { type: "string" },
		checkpoint: { type: "string" },
		publish: { type: "boolean", default: false },
	},
});
if (
	!values.assets ||
	!values.account ||
	!/^[a-f0-9]{32}$/.test(values.account) ||
	!values.prefix ||
	!/^v3\/[a-z0-9-]{1,80}$/.test(values.prefix) ||
	!values.checkpoint
)
	throw new Error(
		"Provide --assets, --account, --prefix v3/RELEASE and --checkpoint",
	);
const directory = resolve(values.assets),
	checkpoint = resolve(values.checkpoint),
	bucket = "chromacollection-index";
const report = JSON.parse(
	await readFile(resolve(directory, "release-report.json"), "utf8"),
);
if (
	report.status !== "complete" ||
	!Array.isArray(report.files) ||
	!report.files.length
)
	throw new Error("A complete packaged release is required");
interface FileEntry {
	path: string;
	bytes: number;
	sha256: string;
}
const files: FileEntry[] = [];
const paths = new Set<string>();
for (const file of report.files) {
	if (
		!file ||
		typeof file.path !== "string" ||
		!/^(?:manifest\.json|directory\.bin\.gz|tiles\/\d{1,2}_-?\d{1,2}_-?\d{1,2}\.bin\.gz|metadata\/\d+\.json\.gz|samples\/\d+\.pack)$/.test(
			file.path,
		) ||
		paths.has(file.path) ||
		!Number.isSafeInteger(file.bytes) ||
		file.bytes < 1 ||
		!/^[a-f0-9]{64}$/.test(file.sha256)
	)
		throw new Error("Invalid release upload inventory");
	paths.add(file.path);
	files.push(file);
}
const manifest = files.find((file) => file.path === "manifest.json");
if (!manifest) throw new Error("Release has no manifest");
const scope = {
	account: values.account,
	bucket,
	prefix: values.prefix,
	manifest: manifest.sha256,
};
const receipts = new Map<string, string>();
try {
	const lines = (await readFile(checkpoint, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	if (JSON.stringify(lines[0]) !== JSON.stringify(scope))
		throw new Error("Upload checkpoint belongs to another release");
	for (const line of lines.slice(1))
		if (typeof line.path === "string" && typeof line.sha256 === "string")
			receipts.set(line.path, line.sha256);
} catch (error) {
	if (
		!(
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		)
	)
		throw error;
	await appendFile(checkpoint, `${JSON.stringify(scope)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
}
let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token && values["token-file"]) {
	const auth = await readFile(values["token-file"], "utf8");
	token = auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
}
if (!token)
	throw new Error(
		"Provide CLOUDFLARE_API_TOKEN or --token-file for an existing Wrangler login",
	);
const authorization = `Bearer ${token}`;
const base = `https://api.cloudflare.com/client/v4/accounts/${scope.account}/r2/buckets/${bucket}/objects/${scope.prefix}`;
let nextRequest = 0;
async function request(
	path: string,
	init: RequestInit = {},
): Promise<Response> {
	for (let attempt = 0; attempt < 6; attempt++) {
		const scheduled = Math.max(Date.now(), nextRequest);
		nextRequest = scheduled + 350;
		await delay(Math.max(0, scheduled - Date.now()));
		const response = await fetch(`${base}/${path}`, {
			...init,
			signal: AbortSignal.timeout(120000),
			headers: { Authorization: authorization, ...init.headers },
		});
		if (response.status !== 429 && response.status < 500) return response;
		await response.body?.cancel();
		const retry = Number(response.headers.get("retry-after"));
		console.log(
			`Upload retry: HTTP ${response.status}, attempt ${attempt + 1}`,
		);
		await delay(
			Math.max(
				Number.isFinite(retry) ? retry * 1000 : 0,
				Math.min(60000, 1000 * 2 ** attempt),
			),
		);
	}
	throw new Error(
		"Upload paused after repeated server/rate-limit failures; keep the checkpoint",
	);
}
const existing = await request("manifest.json");
if (existing.ok) {
	const hash = createHash("sha256")
		.update(new Uint8Array(await existing.arrayBuffer()))
		.digest("hex");
	if (hash !== manifest.sha256)
		throw new Error(
			"A different immutable release already exists at this prefix",
		);
	console.log(
		"This exact release is already published; nothing was overwritten.",
	);
} else {
	if (existing.status !== 404)
		throw new Error(
			`Cannot verify release destination (HTTP ${existing.status})`,
		);
	await existing.body?.cancel();
	let next = 0,
		complete = 0;
	const pending = files.filter((file) => file.path !== "manifest.json");
	async function upload(file: FileEntry) {
		if (receipts.get(file.path) === file.sha256) return;
		const path = resolve(directory, file.path),
			info = await lstat(path);
		if (
			!path.startsWith(`${directory}${sep}`) ||
			!info.isFile() ||
			info.isSymbolicLink() ||
			info.size !== file.bytes
		)
			throw new Error("Release file changed before upload");
		const bytes = await readFile(path);
		if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
			throw new Error("Release file checksum changed before upload");
		const md5 = createHash("md5").update(bytes).digest("hex");
		const response = await request(file.path, {
			method: "PUT",
			body: bytes,
			headers: {
				"content-type": file.path.endsWith(".json")
					? "application/json"
					: "application/octet-stream",
				"cache-control": "public, max-age=31536000, immutable, no-transform",
				"if-none-match": "*",
			},
		});
		if (response.status === 412) {
			const saved = await request(file.path);
			if (
				!saved.ok ||
				createHash("sha256")
					.update(new Uint8Array(await saved.arrayBuffer()))
					.digest("hex") !== file.sha256
			)
				throw new Error("Refusing to overwrite a different existing object");
		} else {
			if (!response.ok)
				throw new Error(`Object upload failed (HTTP ${response.status})`);
			const result = await response.json();
			if (
				result.success !== true ||
				Number(result.result?.size) !== file.bytes ||
				result.result?.etag !== md5
			)
				throw new Error(
					"R2 did not confirm the expected object checksum and size",
				);
		}
		await appendFile(
			checkpoint,
			`${JSON.stringify({ path: file.path, sha256: file.sha256, bytes: file.bytes, etag: md5 })}\n`,
		);
		receipts.set(file.path, file.sha256);
	}
	console.log(
		`Upload PID ${process.pid}; ${pending.length} assets; bucket ${bucket}; prefix ${scope.prefix}`,
	);
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			while (next < pending.length) {
				await upload(pending[next++]);
				complete++;
				if (complete % 100 === 0 || complete === pending.length)
					console.log(`Verified uploads: ${complete}/${pending.length}`);
			}
		}),
	);
	if (values.publish) {
		await upload(manifest);
		console.log("Manifest published after all assets were confirmed by R2.");
	} else
		console.log(
			"Assets uploaded. Manifest remains unpublished; rerun with --publish after release verification.",
		);
}
