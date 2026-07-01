import { describe, expect, it } from "bun:test";

import {
	extractUrls,
	extractWebRequests,
	guardUrl,
	snapToUserUrl,
	stripWebTags,
} from "./web.ts";

describe("web tags", () => {
	it("extracts search and fetch requests in order", () => {
		const reqs = extractWebRequests(
			"hmm\n<search>mars weather</search>\n<fetch>https://example.com</fetch>",
		);
		expect(reqs).toEqual([
			{ kind: "search", value: "mars weather" },
			{ kind: "fetch", value: "https://example.com" },
		]);
	});

	it("dedupes repeated identical tags", () => {
		const reqs = extractWebRequests("<search>x</search><search>x</search>");
		expect(reqs.length).toBe(1);
	});

	it("strips tags from the user-facing text", () => {
		expect(stripWebTags("answer\n\n<search>q</search>")).toBe("answer");
	});
});

describe("shared-link snapping", () => {
	const owner =
		"https://georgiiantipin.com/blog/valve-s-action-to-conquer-the-pc-world-has-begun";

	it("pulls http(s) URLs out of a message, trimming trailing punctuation", () => {
		expect(
			extractUrls(`read this: ${owner}. wdyt? and (https://example.com)`),
		).toEqual([owner, "https://example.com"]);
	});

	it("snaps a mangled-case fetch back to the owner's exact URL", () => {
		const mangled = owner.replace("valve-s", "Valve-s"); // what a small model emits → 404
		expect(snapToUserUrl(mangled, [owner])).toBe(owner);
	});

	it("ignores a trailing slash when matching", () => {
		expect(snapToUserUrl(`${owner}/`, [owner])).toBe(owner);
	});

	it("leaves a genuinely different URL alone", () => {
		expect(snapToUserUrl("https://elsewhere.com/x", [owner])).toBe(
			"https://elsewhere.com/x",
		);
	});
});

describe("guardUrl (SSRF guard)", () => {
	it("allows a public https URL", () => {
		expect(() => guardUrl("https://example.com/page")).not.toThrow();
	});

	const blocked = [
		"http://localhost/x",
		"http://127.0.0.1",
		"http://10.0.0.5",
		"http://192.168.1.1",
		"http://172.16.0.1",
		"http://169.254.0.1",
		"http://100.100.0.1", // CGNAT / tailnet range
		"http://box.ts.net",
		"ftp://example.com",
		"not-a-url",
	];
	for (const url of blocked) {
		it(`blocks ${url}`, () => {
			expect(() => guardUrl(url)).toThrow();
		});
	}
});
