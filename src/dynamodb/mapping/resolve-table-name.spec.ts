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

	test("prefixes the model name the schema declares", () => {
		const config = {
			tableNamePrefix: "auth_",
			resolveSchemaModelName: (defaultModelName: string) => {
				if (defaultModelName === "user") {
					return "user_custom";
				}
				return undefined;
			},
		};

		expect(
			resolveTableName({ model: "user", getDefaultModelName, config }),
		).toBe("auth_user_custom");
		expect(
			resolveTableName({ model: "session", getDefaultModelName, config }),
		).toBe("auth_session");
	});

	test("hands the default model name to tableNameResolver", () => {
		const name = resolveTableName({
			model: "users",
			getDefaultModelName: () => "user",
			config: {
				tableNameResolver: (modelName: string) => `custom_${modelName}`,
				resolveSchemaModelName: () => "user_custom",
			},
		});

		expect(name).toBe("custom_user");
	});

	test("throws when no resolver or prefix", () => {
		const error = captureError(() =>
			resolveTableName({
				model: "user",
				getDefaultModelName,
				config: {},
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("MISSING_TABLE_RESOLVER");
		}
	});
});
