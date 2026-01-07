/**
 * @file Tests for DynamoDB table name resolution.
 */
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { DynamoDBAdapterError } from "../errors/errors";
import { resolveTableName } from "./table-name";

describe("resolveTableName", () => {
	const getDefaultModelName = (model: string) => model;

	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	const { documentClient } = createDocumentClientStub({
		respond: async () => ({}),
	});

	test("uses tableNameResolver when provided", () => {
		const resolver = (modelName: string) => `custom_${modelName}`;
		const name = resolveTableName({
			model: "user",
			getDefaultModelName,
			config: { documentClient, tableNameResolver: resolver },
		});

		expect(name).toBe("custom_user");
	});

	test("uses tableNamePrefix when provided", () => {
		const name = resolveTableName({
			model: "user",
			getDefaultModelName,
			config: { documentClient, tableNamePrefix: "auth_" },
		});

		expect(name).toBe("auth_user");
	});

	test("throws when no resolver or prefix", () => {
		const error = captureError(() =>
			resolveTableName({
				model: "user",
				getDefaultModelName,
				config: { documentClient },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("MISSING_TABLE_RESOLVER");
		}
	});
});
