import { describe, expect, it } from "bun:test";

import { extractWebRequests, guardUrl, stripWebTags } from "./web.ts";

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
