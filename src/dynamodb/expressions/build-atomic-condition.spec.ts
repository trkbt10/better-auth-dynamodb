/**
 * @file Tests for the atomic write condition builder.
 */
import type { DynamoDBWhere } from "../types";
import { DynamoDBAdapterError } from "../errors/errors";
import {
	buildAtomicCondition,
	canEvaluateWhereOnServer,
} from "./build-atomic-condition";

describe("buildAtomicCondition", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("requires the row to exist when the where clause is empty", () => {
		const condition = buildAtomicCondition({
			model: "verification",
			where: [],
			primaryKeyName: "id",
			getFieldName,
		});

		expect(condition).toEqual({
			conditionExpression: "attribute_exists(#pk)",
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: {},
		});
	});

	test("lowers the where clause, primary key included, into the condition", () => {
		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "v1" },
			{ field: "count", operator: "lt", value: 10 },
		];

		const condition = buildAtomicCondition({
			model: "verification",
			where,
			primaryKeyName: "id",
			getFieldName,
		});

		expect(condition.conditionExpression).toBe(
			"attribute_exists(#pk) AND (#f0 = :v0 AND #f1 < :v1)",
		);
		expect(condition.expressionAttributeNames).toEqual({
			"#pk": "id",
			"#f0": "id",
			"#f1": "count",
		});
		expect(condition.expressionAttributeValues).toEqual({
			":v0": "v1",
			":v1": 10,
		});
	});

	test("keeps OR connectors grouped inside the condition", () => {
		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "v1" },
			{ field: "status", operator: "eq", value: "a", connector: "OR" },
			{ field: "status", operator: "eq", value: "b", connector: "OR" },
		];

		const condition = buildAtomicCondition({
			model: "verification",
			where,
			primaryKeyName: "id",
			getFieldName,
		});

		expect(condition.conditionExpression).toBe(
			"attribute_exists(#pk) AND ((#f0 = :v0) AND (#f1 = :v1 OR #f2 = :v2))",
		);
	});

	test("pins requested fields to the snapshot", () => {
		const condition = buildAtomicCondition({
			model: "user",
			where: [{ field: "id", operator: "eq", value: "u1" }],
			primaryKeyName: "id",
			getFieldName,
			snapshot: { id: "u1", count: 3, note: null },
			pinnedFields: ["count", "note", "missing", "count"],
		});

		expect(condition.conditionExpression).toBe(
			"attribute_exists(#pk) AND (#f0 = :v0) AND #pin0 = :pin0 AND #pin1 = :pin1 AND attribute_not_exists(#pin2)",
		);
		expect(condition.expressionAttributeNames).toEqual({
			"#pk": "id",
			"#f0": "id",
			"#pin0": "count",
			"#pin1": "note",
			"#pin2": "missing",
		});
		expect(condition.expressionAttributeValues).toEqual({
			":v0": "u1",
			":pin0": 3,
			":pin1": null,
		});
	});

	test("pins every where field when an operator cannot run on the server", () => {
		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "v1" },
			{ field: "identifier", operator: "ends_with", value: "-xyz" },
		];

		const condition = buildAtomicCondition({
			model: "verification",
			where,
			primaryKeyName: "id",
			getFieldName,
			snapshot: { id: "v1", identifier: "abc-xyz" },
		});

		expect(canEvaluateWhereOnServer(where)).toBe(false);
		expect(condition.conditionExpression).toBe(
			"attribute_exists(#pk) AND #pin0 = :pin0 AND #pin1 = :pin1",
		);
		expect(condition.expressionAttributeNames).toEqual({
			"#pk": "id",
			"#pin0": "id",
			"#pin1": "identifier",
		});
		expect(condition.expressionAttributeValues).toEqual({
			":pin0": "v1",
			":pin1": "abc-xyz",
		});
	});

	test("refuses to pin fields without a snapshot", () => {
		const error = captureError(() =>
			buildAtomicCondition({
				model: "verification",
				where: [{ field: "identifier", operator: "ends_with", value: "x" }],
				primaryKeyName: "id",
				getFieldName,
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
	});

	test("resolves field names through getFieldName", () => {
		const condition = buildAtomicCondition({
			model: "user",
			where: [{ field: "emailAddress", operator: "ends_with", value: "@x" }],
			primaryKeyName: "pk",
			getFieldName: (props) => `col_${props.field}`,
			snapshot: { col_emailAddress: "a@x" },
		});

		expect(condition.expressionAttributeNames).toEqual({
			"#pk": "pk",
			"#pin0": "col_emailAddress",
		});
	});
});
