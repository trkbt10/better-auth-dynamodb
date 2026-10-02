/**
 * @file Tests for DynamoDB update expression builder.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import { buildUpdateExpression } from "./build-update-expression";

describe("buildUpdateExpression", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("builds update expression and attributes", () => {
		const result = buildUpdateExpression({ name: "Ada", age: 30 });

		expect(result.updateExpression).toBe("SET #u0 = :u0, #u1 = :u1");
		expect(result.expressionAttributeNames).toEqual({ "#u0": "name", "#u1": "age" });
		expect(result.expressionAttributeValues).toEqual({ ":u0": "Ada", ":u1": 30 });
	});

	test("assigns lists, maps and null as whole values", () => {
		const result = buildUpdateExpression({
			tags: ["x", "z"],
			prefs: { a: 1, b: 2 },
			note: null,
		});

		expect(result.updateExpression).toBe("SET #u0 = :u0, #u1 = :u1, #u2 = :u2");
		expect(result.expressionAttributeValues).toEqual({
			":u0": ["x", "z"],
			":u1": { a: 1, b: 2 },
			":u2": null,
		});
	});

	test("gives values that look alike a placeholder each", () => {
		const result = buildUpdateExpression({ name: "5", count: 5 });

		expect(result.expressionAttributeValues).toEqual({ ":u0": "5", ":u1": 5 });
	});

	test("removes attributes that are set to undefined", () => {
		const mixed = buildUpdateExpression({
			name: "Ada",
			nickname: undefined,
			age: 30,
		});
		const removalOnly = buildUpdateExpression({ nickname: undefined });

		expect(mixed.updateExpression).toBe("SET #u0 = :u0, #u2 = :u2 REMOVE #u1");
		expect(mixed.expressionAttributeNames).toEqual({
			"#u0": "name",
			"#u1": "nickname",
			"#u2": "age",
		});
		expect(mixed.expressionAttributeValues).toEqual({ ":u0": "Ada", ":u2": 30 });
		expect(removalOnly.updateExpression).toBe("REMOVE #u0");
		expect(removalOnly.expressionAttributeValues).toEqual({});
	});

	test("throws on empty update", () => {
		const error = captureError(() => buildUpdateExpression({}));
		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});
});
