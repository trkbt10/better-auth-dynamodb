/**
 * @file Tests for DynamoDB filter expression builder.
 */
import type { DynamoDBWhere } from "../types";
import { buildFilterExpression } from "./filter-expression";

describe("buildFilterExpression", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("builds equality expression", () => {
		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = buildFilterExpression({
			where,
			model: "user",
			getFieldName,
		});

		expect(result.filterExpression).toBe("#f0 = :v0");
		expect(result.expressionAttributeNames).toEqual({ "#f0": "email" });
		expect(result.expressionAttributeValues).toEqual({ ":v0": "a@example.com" });
		expect(result.requiresClientFilter).toBe(false);
	});

	test("combines AND and OR expressions", () => {
		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
			{
				field: "status",
				operator: "eq",
				value: "active",
				connector: "OR",
			},
		];
		const result = buildFilterExpression({
			where,
			model: "user",
			getFieldName,
		});

		expect(result.filterExpression).toBe("(#f0 = :v0) AND (#f1 = :v1)");
	});

	test("flags client-only operators", () => {
		const where: DynamoDBWhere[] = [
			{ field: "name", operator: "ends_with", value: "son" },
		];
		const result = buildFilterExpression({
			where,
			model: "user",
			getFieldName,
		});

		expect(result.filterExpression).toBeUndefined();
		expect(result.requiresClientFilter).toBe(true);
	});
});
