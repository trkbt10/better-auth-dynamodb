/**
 * @file Tests for in-memory where evaluation.
 */
import type { NormalizedWhere } from "../query-plan";
import { applyWhereFilters } from "./where-evaluator";

describe("applyWhereFilters", () => {
	test("filters with AND conditions", () => {
		const items = [
			{ id: "1", name: "alpha", age: 2 },
			{ id: "2", name: "beta", age: 5 },
		];
		const where: NormalizedWhere[] = [
			{
				field: "age",
				operator: "gt",
				value: 3,
				connector: "AND",
				requiresClientFilter: false,
			},
			{
				field: "name",
				operator: "ends_with",
				value: "ta",
				connector: "AND",
				requiresClientFilter: true,
			},
		];

		const result = applyWhereFilters({
			items,
			where,
		});

		expect(result).toEqual([{ id: "2", name: "beta", age: 5 }]);
	});

	test("filters with OR conditions", () => {
		const items = [
			{ id: "1", status: "active" },
			{ id: "2", status: "inactive" },
		];
		const where: NormalizedWhere[] = [
			{
				field: "status",
				operator: "eq",
				value: "active",
				connector: "OR",
				requiresClientFilter: false,
			},
			{
				field: "status",
				operator: "eq",
				value: "inactive",
				connector: "OR",
				requiresClientFilter: false,
			},
		];

		const result = applyWhereFilters({
			items,
			where,
		});

		expect(result.map((item) => item.id)).toEqual(["1", "2"]);
	});
});
