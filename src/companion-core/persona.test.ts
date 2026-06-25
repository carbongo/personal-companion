import { describe, expect, it } from "bun:test";

import { config } from "#/config/index.ts";
import { setSetting } from "./memory/store.ts";
import { buildIdentity, buildOperating } from "./persona.ts";

describe("buildIdentity", () => {
	it("falls back to a preset that names the companion", () => {
		const id = buildIdentity();
		expect(id).toContain(config.app.name);
	});

	it("honors a settings override with {{name}}/{{owner}} interpolation", () => {
		setSetting("persona", "I am {{name}}, here for {{owner}}.");
		expect(buildIdentity()).toBe(
			`I am ${config.app.name}, here for ${config.app.owner}.`,
		);
	});
});

describe("buildOperating", () => {
	it("describes the memory sidecar tags", () => {
		const op = buildOperating({ web: true });
		expect(op).toContain("<remember>");
		expect(op).toContain("<core>");
	});

	it("includes web tags only when web access is on", () => {
		expect(buildOperating({ web: true })).toContain("<search>");
		expect(buildOperating({ web: false })).not.toContain("<search>");
	});
});
