/**
 * @file Tests for fetch limit resolver.
 */
import { resolveFetchLimit } from "./resolve-fetch-limit";

describe("resolveFetchLimit", () => {
	test("returns undefined when client filter required", () => {
		const result = resolveFetchLimit({
			limit: 10,
			requiresClientFilter: true,
		});

		expect(result).toBeUndefined();
	});

	test("returns limit when filter not required", () => {
		const result = resolveFetchLimit({
			limit: 4,
			requiresClientFilter: false,
		});

		expect(result).toBe(4);
	});
});
