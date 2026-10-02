/**
 * @file Tests for DynamoDB string ordering.
 */
import { compareStrings } from "./compare-strings";

describe("compareStrings", () => {
	test("orders plain strings like the default comparison", () => {
		expect(compareStrings("a", "b")).toBeLessThan(0);
		expect(compareStrings("b", "a")).toBeGreaterThan(0);
		expect(compareStrings("a", "a")).toBe(0);
		expect(compareStrings("a", "ab")).toBeLessThan(0);
		expect(compareStrings("2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z")).toBeLessThan(0);
	});

	test("orders by code point where UTF-16 code units disagree", () => {
		const privateUse = "";
		const emoji = "\u{1F600}";

		// UTF-16 puts the surrogate pair first; UTF-8 (DynamoDB) puts it last.
		expect(emoji < privateUse).toBe(true);
		expect(compareStrings(emoji, privateUse)).toBeGreaterThan(0);
		expect(compareStrings(privateUse, emoji)).toBeLessThan(0);
	});
});
