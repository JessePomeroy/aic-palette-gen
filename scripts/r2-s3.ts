import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
	LEGACY_FILE,
	LEGACY_RELEASES,
} from "../workers/color-index/legacy.mjs";

export const SAFETY_KEY = "__maintenance__/legacy-compat-20260916-7b40d58b.txt";
export type ObjectTransport = (
	key: string,
	init?: RequestInit,
) => Promise<Response>;

export function assertMigrationRequest(key: string, init: RequestInit = {}) {
	const method = init.method ?? "GET";
	const [prefix, release, ...parts] = key.split("/");
	if (
		key !== SAFETY_KEY &&
		(prefix !== "v2" ||
			!LEGACY_RELEASES.includes(release) ||
			!LEGACY_FILE.test(parts.join("/")))
	)
		throw new Error("S3 request is outside the approved migration keys");
	if (
		!["GET", "PUT", "DELETE"].includes(method) ||
		(method === "DELETE" && key !== SAFETY_KEY) ||
		(method === "PUT" && new Headers(init.headers).get("if-none-match") !== "*")
	)
		throw new Error(
			"Only reads, create-only PUTs, and disposable-key cleanup are allowed",
		);
	if (init.body && method !== "PUT")
		throw new Error("Only PUT may have a request body");
	for (const name of new Headers(init.headers).keys())
		if (!["if-none-match", "content-type", "cache-control"].includes(name))
			throw new Error("Unexpected migration request header");
}

export function parseCurlResponse(bytes: Buffer): Response {
	let offset = 0;
	while (offset < bytes.length) {
		const end = bytes.indexOf("\r\n\r\n", offset);
		if (end < 0) throw new Error("Malformed S3 response headers");
		const [statusLine, ...lines] = bytes
			.subarray(offset, end)
			.toString("latin1")
			.split("\r\n");
		const match = /^HTTP\/\S+ (\d{3})(?: |$)/.exec(statusLine);
		if (!match) throw new Error("Malformed S3 status");
		const status = Number(match[1]);
		offset = end + 4;
		if (status < 200) continue;
		const headers = new Headers();
		for (const line of lines) {
			const colon = line.indexOf(":");
			if (colon <= 0) throw new Error("Malformed S3 header");
			headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
		}
		return new Response(
			status === 204 || status === 304
				? null
				: Uint8Array.from(bytes.subarray(offset)),
			{ status, headers },
		);
	}
	throw new Error("Missing S3 response");
}

export async function createS3Transport(
	credentialsFile: string,
): Promise<ObjectTransport> {
	const stat = await lstat(credentialsFile);
	if (
		!stat.isFile() ||
		(stat.mode & 0o077) !== 0 ||
		(process.getuid && stat.uid !== process.getuid())
	)
		throw new Error(
			"Credentials must be an owner-only regular file (mode 600), not a symlink",
		);
	let credentials: { accessKeyId: string; secretAccessKey: string };
	try {
		const data: unknown = JSON.parse(await readFile(credentialsFile, "utf8"));
		if (
			!data ||
			typeof data !== "object" ||
			!("accessKeyId" in data) ||
			!("secretAccessKey" in data) ||
			typeof data.accessKeyId !== "string" ||
			typeof data.secretAccessKey !== "string" ||
			!/^[a-f0-9]{32}$/.test(data.accessKeyId) ||
			!/^[a-f0-9]{64}$/.test(data.secretAccessKey)
		)
			throw new Error();
		credentials = {
			accessKeyId: data.accessKeyId,
			secretAccessKey: data.secretAccessKey,
		};
	} catch {
		throw new Error("Invalid R2 S3 credential file; contents omitted");
	}
	const endpoint =
		"https://18829b4109eeb19a0f0d69089a5caa14.r2.cloudflarestorage.com/chromacollection-index";
	return async (key, init = {}) => {
		assertMigrationRequest(key, init);
		const body = init.body
			? Buffer.from(await new Response(init.body).arrayBuffer())
			: Buffer.alloc(0);
		if (body.length > 16 * 1024 * 1024)
			throw new Error("Migration object is too large");
		const headers = new Headers(init.headers);
		headers.set(
			"x-amz-content-sha256",
			createHash("sha256").update(body).digest("hex"),
		);
		if (init.method === "PUT")
			headers.set("content-length", String(body.length));
		// Curl >=8.3 expands credentials from its private environment, never argv/logs.
		const args = [
			"-q",
			"--silent",
			"--variable",
			"%CHROMA_R2_AUTH",
			"--expand-user",
			"{{CHROMA_R2_AUTH}}",
			"--aws-sigv4",
			"aws:amz:auto:s3",
			"--proto",
			"=https",
			"--include",
			"--suppress-connect-headers",
			"--max-time",
			"120",
			"--connect-timeout",
			"15",
			"--request",
			init.method ?? "GET",
		];
		for (const [name, value] of headers)
			args.push("--header", `${name}: ${value}`);
		if (init.method === "PUT") args.push("--data-binary", "@-");
		args.push(`${endpoint}/${key}`);
		const response = await new Promise<Buffer>((resolve, reject) => {
			const child = spawn("curl", args, {
				stdio: ["pipe", "pipe", "ignore"],
				env: {
					...process.env,
					CHROMA_R2_AUTH: `${credentials.accessKeyId}:${credentials.secretAccessKey}`,
				},
			});
			const chunks: Buffer[] = [];
			let length = 0;
			child.stdout.on("data", (chunk: Buffer) => {
				length += chunk.length;
				if (length > 17 * 1024 * 1024) child.kill("SIGTERM");
				else chunks.push(chunk);
			});
			child.on("error", () =>
				reject(new Error("Could not start curl S3 transport")),
			);
			child.on("close", (code) =>
				code === 0
					? resolve(Buffer.concat(chunks))
					: reject(
							new Error(
								`S3 transport failed (curl exit ${code}); no credential values logged`,
							),
						),
			);
			child.stdin.on("error", () => {});
			child.stdin.end(body);
		});
		return parseCurlResponse(response);
	};
}
