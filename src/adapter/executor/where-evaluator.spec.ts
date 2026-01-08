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

	test("returns all items when where is undefined", () => {
		const items = [{ id: "1" }, { id: "2" }];

		const result = applyWhereFilters({ items, where: undefined });

		expect(result).toEqual(items);
	});

	test("returns all items when where is empty", () => {
		const items = [{ id: "1" }, { id: "2" }];

		const result = applyWhereFilters({ items, where: [] });

		expect(result).toEqual(items);
	});

	test("excludes items when OR conditions all fail", () => {
		const items = [
			{ id: "1", status: "pending" },
			{ id: "2", status: "active" },
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

		const result = applyWhereFilters({ items, where });

		expect(result).toEqual([{ id: "2", status: "active" }]);
	});

	test("excludes items when AND condition fails", () => {
		const items = [
			{ id: "1", name: "test", age: 10 },
			{ id: "2", name: "test", age: 5 },
		];
		const where: NormalizedWhere[] = [
			{
				field: "name",
				operator: "eq",
				value: "test",
				connector: "AND",
				requiresClientFilter: false,
			},
			{
				field: "age",
				operator: "gt",
				value: 7,
				connector: "AND",
				requiresClientFilter: false,
			},
		];

		const result = applyWhereFilters({ items, where });

		expect(result).toEqual([{ id: "1", name: "test", age: 10 }]);
	});

	test("handles mixed AND and OR conditions", () => {
		const items = [
			{ id: "1", type: "a", status: "active" },
			{ id: "2", type: "b", status: "inactive" },
			{ id: "3", type: "a", status: "inactive" },
		];
		const where: NormalizedWhere[] = [
			{
				field: "type",
				operator: "eq",
				value: "a",
				connector: "AND",
				requiresClientFilter: false,
			},
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

		const result = applyWhereFilters({ items, where });

		expect(result.map((item) => item.id)).toEqual(["1", "3"]);
	});
});
