/**
 * @file Tests for count adapter method.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { getAuthTables } from "@better-auth/core/db";
import { initGetDefaultModelName, initGetFieldName } from "@better-auth/core/db/adapter";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createCountMethod } from "./count";
import { createDocumentClientStub } from "../../spec/dynamodb-document-client";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";

const buildSchemaHelpers = () => {
	const options: BetterAuthOptions = {};
	const schema = getAuthTables(options);
	const getDefaultModelName = initGetDefaultModelName({
		schema,
		usePlural: false,
	});
	const getFieldName = initGetFieldName({
		schema,
		usePlural: false,
	});
	return { getDefaultModelName, getFieldName };
};

const indexNameResolver = (props: { model: string; field: string }) => {
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	if (props.model === "session" && props.field === "token") {
		return "session_token_idx";
	}
	return undefined;
};

const indexKeySchemaResolver = (props: { model: string; indexName: string }) => {
	if (props.model === "session" && props.indexName === "session_userId_idx") {
		return { partitionKey: "userId", sortKey: "createdAt" };
	}
	if (props.model === "session" && props.indexName === "session_token_idx") {
		return { partitionKey: "token", sortKey: "createdAt" };
	}
	return undefined;
};

describe("createCountMethod", () => {
	const helpers = buildSchemaHelpers();

	test("counts with query strategy for indexed fields", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Count: 5, ScannedCount: 5 };
				}
				return {};
			},
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: 10,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const result = await count({
			model: "session",
			where: [{ field: "userId", operator: "eq", value: "user_1" }],
		});

		expect(result).toBe(5);
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});

	test("counts with scan strategy for non-indexed fields", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return { Count: 3, ScannedCount: 10, LastEvaluatedKey: undefined };
				}
				return {};
			},
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: 10,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const result = await count({
			model: "user",
			where: [{ field: "email", operator: "eq", value: "test@example.com" }],
		});

		expect(result).toBe(3);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});

	test("throws error when scanMaxPages is undefined for scan strategy", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({}),
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: undefined,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await expect(
			count({
				model: "user",
				where: [{ field: "email", operator: "eq", value: "test@example.com" }],
			}),
		).rejects.toThrow(DynamoDBAdapterError);
	});

	test("uses client filter for ends_with operator", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return {
						Items: [
							{ id: "1", email: "test@example.com" },
							{ id: "2", email: "other@example.com" },
							{ id: "3", email: "test@other.org" },
						],
						LastEvaluatedKey: undefined,
					};
				}
				return {};
			},
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: 10,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const result = await count({
			model: "user",
			where: [{ field: "email", operator: "ends_with", value: "@example.com" }],
		});

		expect(result).toBe(2);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});

	test("uses batch-get strategy for id IN queries", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({
				Responses: {
					user: [{ id: "1" }, { id: "2" }],
				},
			}),
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: 10,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const result = await count({
			model: "user",
			where: [{ field: "id", operator: "in", value: ["1", "2", "3"] }],
		});

		expect(result).toBe(2);
		expect(sendCalls.length).toBeGreaterThan(0);
	});

	test("counts without where clause using scan", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return { Count: 100, ScannedCount: 100, LastEvaluatedKey: undefined };
				}
				return {};
			},
		});

			const adapterConfig: ResolvedDynamoDBAdapterConfig = {
				documentClient,
				usePlural: false,
				debugLogs: undefined,
				tableNamePrefix: "",
				tableNameResolver: (model) => model,
				scanMaxPages: 10,
				scanPageLimitMode: "throw",
				explainQueryPlans: false,
				explainDynamoOperations: false,
				indexNameResolver,
				indexKeySchemaResolver,
				transaction: false,
			};

		const count = createCountMethod({ documentClient }, {
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const result = await count({ model: "user" });

		expect(result).toBe(100);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});
});
