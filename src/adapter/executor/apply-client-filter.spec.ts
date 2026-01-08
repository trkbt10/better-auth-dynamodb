/**
 * @file Tests for client-side filter application.
 */
import { applyClientFilter } from "./apply-client-filter";
import type { NormalizedWhere } from "../query-plan";

describe("applyClientFilter", () => {
	test("returns items when filtering not required", () => {
		const items = [{ id: "1" }, { id: "2" }];
		const result = applyClientFilter({
			items,
			where: undefined,
			requiresClientFilter: false,
		});

		expect(result).toBe(items);
	});

	test("filters items when required", () => {
		const items = [
			{ id: "1", name: "alpha" },
			{ id: "2", name: "beta" },
		];
		const where: NormalizedWhere[] = [
			{
				field: "name",
				operator: "ends_with",
				value: "ta",
				connector: "AND",
				requiresClientFilter: true,
			},
		];
		const result = applyClientFilter({
			items,
			where,
			requiresClientFilter: true,
		});

		expect(result).toEqual([{ id: "2", name: "beta" }]);
	});
});
