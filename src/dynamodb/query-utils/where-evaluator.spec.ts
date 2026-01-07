/**
 * @file Tests for in-memory where evaluation.
 */
import type { DynamoDBWhere } from "../types";
import { applyWhereFilters } from "./where-evaluator";

describe("applyWhereFilters", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("filters with AND conditions", () => {
		const items = [
			{ id: "1", name: "alpha", age: 2 },
			{ id: "2", name: "beta", age: 5 },
		];
		const where: DynamoDBWhere[] = [
			{ field: "age", operator: "gt", value: 3 },
			{ field: "name", operator: "ends_with", value: "ta" },
		];

		const result = applyWhereFilters({
			items,
			where,
			model: "user",
			getFieldName,
		});

		expect(result).toEqual([{ id: "2", name: "beta", age: 5 }]);
	});

	test("filters with OR conditions", () => {
		const items = [
			{ id: "1", status: "active" },
			{ id: "2", status: "inactive" },
		];
		const where: DynamoDBWhere[] = [
			{ field: "status", operator: "eq", value: "active", connector: "OR" },
			{
				field: "status",
				operator: "eq",
				value: "inactive",
				connector: "OR",
			},
		];

		const result = applyWhereFilters({
			items,
			where,
			model: "user",
			getFieldName,
		});

		expect(result.map((item) => item.id)).toEqual(["1", "2"]);
	});
});
