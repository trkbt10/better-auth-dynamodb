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

	test("builds set expression for string changes", () => {
		const result = buildPatchUpdateExpression({
			prev: { name: "Ada" },
			next: { name: "Bob" },
		});

		expect(result.updateExpression).toContain("SET");
		expect(result.expressionAttributeNames).toEqual({ "#a0": "name" });
		expect(result.expressionAttributeValues).toEqual({ ":v0": "Bob" });
	});

	test("handles array element changes", () => {
		const result = buildPatchUpdateExpression({
			prev: { tags: ["a", "b"] },
			next: { tags: ["a", "c"] },
		});

		expect(result.updateExpression).toContain("SET");
	});

	test("handles nested object changes", () => {
		const result = buildPatchUpdateExpression({
			prev: { profile: { city: "Tokyo" } },
			next: { profile: { city: "Osaka" } },
		});

		expect(result.updateExpression).toContain("SET");
		expect(Object.values(result.expressionAttributeNames)).toContain("profile");
		expect(Object.values(result.expressionAttributeNames)).toContain("city");
	});

	test("handles type change from string to number", () => {
		const result = buildPatchUpdateExpression({
			prev: { value: "100" },
			next: { value: 100 },
		});

		expect(result.updateExpression).toContain("SET");
	});

	test("handles adding new field", () => {
		const result = buildPatchUpdateExpression({
			prev: { name: "Ada" },
			next: { name: "Ada", email: "ada@example.com" },
		});

		expect(result.updateExpression).toContain("SET");
	});

	test("handles array length increase", () => {
		const result = buildPatchUpdateExpression({
			prev: { items: ["a"] },
			next: { items: ["a", "b"] },
		});

		expect(result.updateExpression).toContain("SET");
	});

	test("handles array length decrease", () => {
		const result = buildPatchUpdateExpression({
			prev: { items: ["a", "b"] },
			next: { items: ["a"] },
		});

		expect(result.updateExpression).toContain("REMOVE");
	});

	test("reuses attribute name keys for same field", () => {
		const result = buildPatchUpdateExpression({
			prev: { a: { x: 1 }, b: { x: 2 } },
			next: { a: { x: 10 }, b: { x: 20 } },
		});

		const nameValues = Object.values(result.expressionAttributeNames);
		expect(nameValues.filter((v) => v === "x").length).toBe(1);
	});
});
