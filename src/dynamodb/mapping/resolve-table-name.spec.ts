/**
 * @file Tests for DynamoDB table name resolution.
 */
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { DynamoDBAdapterError } from "../errors/errors";
import { resolveTableName } from "./resolve-table-name";

describe("resolveTableName", () => {
	const getDefaultModelName = (model: string) => model;
	const indexNameResolver = () => undefined;

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
			config: {
				documentClient,
				tableNameResolver: resolver,
				indexNameResolver,
			},
		});

		expect(name).toBe("custom_user");
	});

	test("uses tableNamePrefix when provided", () => {
		const name = resolveTableName({
			model: "user",
			getDefaultModelName,
			config: {
				documentClient,
				tableNamePrefix: "auth_",
				indexNameResolver,
			},
		});

		expect(name).toBe("auth_user");
	});

	test("throws when no resolver or prefix", () => {
		const error = captureError(() =>
			resolveTableName({
				model: "user",
				getDefaultModelName,
				config: { documentClient, indexNameResolver },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("MISSING_TABLE_RESOLVER");
		}
	});
});
