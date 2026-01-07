/**
 * @file Tests for DynamoDB adapter errors.
 */
import { DynamoDBAdapterError } from "./errors";

describe("DynamoDBAdapterError", () => {
	test("sets code, name, and message", () => {
		const error = new DynamoDBAdapterError("MISSING_CLIENT", "boom");

		expect(error.code).toBe("MISSING_CLIENT");
		expect(error.name).toBe("DynamoDBAdapterError");
		expect(error.message).toBe("boom");
	});
});
