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

	test("throws on empty update", () => {
		const error = captureError(() => buildUpdateExpression({}));
		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});
});
