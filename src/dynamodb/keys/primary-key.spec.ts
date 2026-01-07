/**
 * @file Tests for DynamoDB primary key helper.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import { buildPrimaryKey } from "./primary-key";

describe("buildPrimaryKey", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("returns key object for existing field", () => {
		const item = { id: "user-1", email: "a@example.com" };
		const key = buildPrimaryKey({ item, keyField: "id" });

		expect(key).toEqual({ id: "user-1" });
	});

	test("throws when field missing", () => {
		const error = captureError(() =>
			buildPrimaryKey({ item: { email: "a" }, keyField: "id" }),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("MISSING_PRIMARY_KEY");
		}
	});
});
