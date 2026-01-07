/**
 * @file Tests for scan limit resolver.
 */
import { resolveScanLimit } from "./resolve-scan-limit";

describe("resolveScanLimit", () => {
	test("returns undefined when client filter needed", () => {
		const result = resolveScanLimit({
			limit: 5,
			offset: 1,
			sortByDefined: false,
			requiresClientFilter: true,
		});

		expect(result).toBeUndefined();
	});

	test("returns undefined when sortBy defined", () => {
		const result = resolveScanLimit({
			limit: 5,
			offset: 1,
			sortByDefined: true,
			requiresClientFilter: false,
		});

		expect(result).toBeUndefined();
	});

	test("adds offset to limit", () => {
		const result = resolveScanLimit({
			limit: 5,
			offset: 2,
			sortByDefined: false,
			requiresClientFilter: false,
		});

		expect(result).toBe(7);
	});
});
