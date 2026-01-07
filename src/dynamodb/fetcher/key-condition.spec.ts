/**
 * @file Tests for key condition builder.
 */
import type { DynamoDBWhere } from "../types";
import { buildKeyCondition } from "./key-condition";

describe("buildKeyCondition", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;

	test("returns null for non-primary key", () => {
		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = buildKeyCondition({
			model: "user",
			where,
			getFieldName,
		});

		expect(result).toBeNull();
	});

	test("builds key condition for id eq", () => {
		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "user-1" },
		];
		const result = buildKeyCondition({
			model: "user",
			where,
			getFieldName,
		});

		expect(result).toEqual({
			keyConditionExpression: "#pk = :pk",
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: { ":pk": "user-1" },
		});
	});
});
