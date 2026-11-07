import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/utils/format";

describe("escapeHtml", () => {
	it("escapes characters that Telegram HTML treats specially", () => {
		expect(escapeHtml("<b>Tom & Jerry</b>")).toBe("&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;");
	});
});
