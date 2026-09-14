import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type Artwork,
	buildSearchQuery,
	getArtwork,
	getRandomArtwork,
} from "../src/lib/api/artic.ts";

test("every discovery query excludes archival groupings without replacing existing filters", () => {
	for (const params of [
		{},
		{ q: "archive", artistId: 7, excludeId: 123, publicDomain: true },
	]) {
		const query = buildSearchQuery(params);
		assert.deepEqual(query.query.bool.must_not, [
			{ term: { artwork_type_id: 45 } },
			...(params.excludeId ? [{ term: { id: params.excludeId } }] : []),
		]);
		assert.ok(query.fields.split(",").includes("artwork_type_id"));
		if (params.artistId)
			assert.ok(
				query.query.bool.filter.some(
					(clause) => JSON.stringify(clause) === '{"term":{"artist_id":7}}',
				),
			);
	}
});

test("random excludes the archival category but retains other types, neutral works and missing type metadata", async (t) => {
	let candidate: Pick<
		Artwork,
		"id" | "title" | "image_id" | "artwork_type_id"
	> = {
		id: 1,
		title: "Archive study in black and white",
		image_id: "image",
		artwork_type_id: 45,
	};
	let countRequests = 0;
	let candidateRequests = 0;
	t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
		const url = new URL(input instanceof Request ? input.url : input);
		assert.equal(url.pathname, "/api/v1/artworks");
		if (!url.searchParams.has("page")) {
			countRequests++;
			return Response.json({ pagination: { total: 20000 } });
		}
		candidateRequests++;
		assert.ok(Number(url.searchParams.get("page")) >= 1);
		assert.ok(Number(url.searchParams.get("page")) <= 10000);
		assert.ok(
			url.searchParams.get("fields")?.split(",").includes("artwork_type_id"),
		);
		return Response.json({ data: [candidate] });
	});
	assert.equal(await getRandomArtwork(), undefined);
	for (const type of [1, null, undefined]) {
		candidate = { ...candidate, artwork_type_id: type };
		assert.equal((await getRandomArtwork())?.id, candidate.id);
	}
	assert.equal(countRequests, 4);
	assert.equal(
		candidateRequests,
		4,
		"Filtering does not introduce another retry loop",
	);
});

test("explicit artwork retrieval remains available for previously saved archival palettes", async (t) => {
	const archive = {
		id: 262367,
		title: "Paul Trebilcock Photograph Collection",
		artwork_type_id: 45,
	};
	t.mock.method(globalThis, "fetch", async () =>
		Response.json({ data: archive }),
	);
	assert.deepEqual(await getArtwork(archive.id), archive);
});
