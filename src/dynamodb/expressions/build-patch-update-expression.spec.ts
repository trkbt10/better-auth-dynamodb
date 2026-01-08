/**
 * @file Tests for patch update expression builder.
 */
import { buildPatchUpdateExpression } from "./build-patch-update-expression";
import { DynamoDBAdapterError } from "../errors/errors";

describe("buildPatchUpdateExpression", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

test("builds add expression for numeric changes", () => {
		const result = buildPatchUpdateExpression({
			prev: { name: "Ada", age: 20 },
			next: { name: "Ada", age: 21 },
		});

	expect(result.updateExpression).toContain("ADD");
		expect(result.expressionAttributeNames).toEqual({ "#a0": "age" });
		expect(result.expressionAttributeValues).toEqual({ ":v0": 1 });
	});

	test("builds remove expression for undefined", () => {
		const result = buildPatchUpdateExpression({
			prev: { name: "Ada", nickname: "ada" },
			next: { name: "Ada", nickname: undefined },
		});

		expect(result.updateExpression).toContain("REMOVE");
		expect(result.expressionAttributeNames).toEqual({ "#a0": "nickname" });
	});

	test("throws when no changes", () => {
		const error = captureError(() =>
			buildPatchUpdateExpression({
				prev: { name: "Ada" },
				next: { name: "Ada" },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("INVALID_UPDATE");
		}
	});
});
