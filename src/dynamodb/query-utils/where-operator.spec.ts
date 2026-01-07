/**
 * @file Tests for DynamoDB where-operator handlers.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import { getOperatorHandler, isClientOnlyOperator, normalizeWhereOperator } from "./where-operator";

describe("getOperatorHandler", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("throws for unsupported operator", () => {
		const error = captureError(() => getOperatorHandler("unknown"));

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("UNSUPPORTED_OPERATOR");
		}
	});

	test("evaluates equality", () => {
		const handler = getOperatorHandler("eq");
		expect(handler.evaluate({ fieldValue: "a", value: "a" })).toBe(true);
		expect(handler.evaluate({ fieldValue: "a", value: "b" })).toBe(false);
	});
});

describe("operator helpers", () => {
	test("detects client-only operators", () => {
		expect(isClientOnlyOperator("ends_with")).toBe(true);
		expect(isClientOnlyOperator("eq")).toBe(false);
	});

	test("normalizes operator defaults", () => {
		expect(normalizeWhereOperator(undefined)).toBe("eq");
		expect(normalizeWhereOperator("GT")).toBe("gt");
	});
});
