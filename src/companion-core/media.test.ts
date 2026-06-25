import { describe, expect, it } from "bun:test";
import { rmSync } from "node:fs";

import {
	contentTypeFor,
	extOf,
	resolveUpload,
	saveUpload,
	sniffImageExt,
	uploadsDir,
} from "./media.ts";

describe("extOf / contentTypeFor", () => {
	it("keeps a safe extension and maps its content type", () => {
		expect(extOf("photo.PNG")).toBe(".png");
		expect(contentTypeFor("photo.PNG")).toBe("image/png");
		expect(contentTypeFor("clip.ogg")).toBe("audio/ogg");
	});

	it("drops a missing or unsafe extension", () => {
		expect(extOf("noext")).toBe("");
		expect(extOf("evil.exe!")).toBe("");
		expect(contentTypeFor("noext")).toBe("application/octet-stream");
	});
});

describe("sniffImageExt", () => {
	it("recognizes PNG, JPEG, GIF, WEBP magic bytes", () => {
		expect(sniffImageExt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
			".png",
		);
		expect(sniffImageExt(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(".jpg");
		expect(sniffImageExt(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(
			".gif",
		);
		const webp = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
		]);
		expect(sniffImageExt(webp)).toBe(".webp");
	});

	it("defaults to .jpg for unknown bytes", () => {
		expect(sniffImageExt(new Uint8Array([0, 1, 2, 3]))).toBe(".jpg");
	});
});

describe("saveUpload / resolveUpload", () => {
	it("round-trips bytes to a /uploads path that resolves back", async () => {
		const url = await saveUpload(new Uint8Array([1, 2, 3]), ".png");
		expect(url).toMatch(/^\/uploads\/[\w.-]+\.png$/);
		const name = url?.slice("/uploads/".length) ?? "";
		const path = resolveUpload(name);
		expect(path).toBeTruthy();
		expect(await Bun.file(path as string).bytes()).toEqual(
			new Uint8Array([1, 2, 3]),
		);
		rmSync(uploadsDir(), { recursive: true, force: true });
	});

	it("refuses path traversal and unknown names", () => {
		expect(resolveUpload("../../etc/passwd")).toBeNull();
		expect(resolveUpload("sub/dir.png")).toBeNull();
		expect(resolveUpload("does-not-exist.png")).toBeNull();
	});
});
