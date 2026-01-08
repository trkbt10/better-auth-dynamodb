/**
 * @file Tests for join execution strategy selection.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { getAuthTables } from "@better-auth/core/db";
import {
	initGetDefaultModelName,
	initGetFieldName,
} from "@better-auth/core/db/adapter";
import { BatchGetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { executeJoin } from "./execute-join";
import type { JoinPlan } from "../query-plan";
import type { DynamoDBAdapterConfig } from "../../adapter";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";

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
	return {
		getDefaultModelName,
		getFieldName,
	};
};

const indexNameResolver = (props: { model: string; field: string }) => {
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	return undefined;
};

describe("executeJoin", () => {
	const helpers = buildSchemaHelpers();

	test("uses QueryCommand for indexed join fields", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ userId: "user_1" }], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig: DynamoDBAdapterConfig = {
			documentClient,
			usePlural: false,
			debugLogs: undefined,
			tableNamePrefix: "",
			tableNameResolver: (model) => model,
			scanMaxPages: 2,
			indexNameResolver,
			transaction: false,
		};
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const joinPlan: JoinPlan = {
			modelKey: "session",
			model: "session",
			relation: "one-to-many",
			on: { from: "id", to: userIdField },
			limit: 10,
			select: undefined,
			strategy: { kind: "query", key: "gsi", indexName: "session_userId_idx" },
		};

		const result = await executeJoin({
			baseItems: [{ id: "user_1" }, { id: "user_2" }],
			join: joinPlan,
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		expect(result.length).toBe(2);
		expect(sendCalls.every((command) => command instanceof QueryCommand)).toBe(
			true,
		);
	});

	test("uses BatchGetCommand for PK joins with multiple values", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof BatchGetCommand) {
					return {
						Responses: {
							session: [{ id: "session_1" }, { id: "session_2" }],
						},
					};
				}
				return {};
			},
		});
		const adapterConfig: DynamoDBAdapterConfig = {
			documentClient,
			usePlural: false,
			debugLogs: undefined,
			tableNamePrefix: "",
			tableNameResolver: (model) => model,
			scanMaxPages: 2,
			indexNameResolver,
			transaction: false,
		};
		const idField = helpers.getFieldName({ model: "session", field: "id" });
		const joinPlan: JoinPlan = {
			modelKey: "session",
			model: "session",
			relation: "one-to-many",
			on: { from: "id", to: idField },
			limit: 10,
			select: undefined,
			strategy: { kind: "query", key: "pk" },
		};

		await executeJoin({
			baseItems: [{ id: "session_1" }, { id: "session_2" }],
			join: joinPlan,
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		expect(sendCalls.length).toBe(1);
		expect(sendCalls[0]).toBeInstanceOf(BatchGetCommand);
	});

	test("uses ScanCommand for non-indexed join fields", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return { Items: [{ userAgent: "agent" }], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig: DynamoDBAdapterConfig = {
			documentClient,
			usePlural: false,
			debugLogs: undefined,
			tableNamePrefix: "",
			tableNameResolver: (model) => model,
			scanMaxPages: 2,
			indexNameResolver,
			transaction: false,
		};
		const joinPlan: JoinPlan = {
			modelKey: "session",
			model: "session",
			relation: "one-to-many",
			on: { from: "id", to: "userAgent" },
			limit: 10,
			select: undefined,
			strategy: { kind: "scan" },
		};

		await executeJoin({
			baseItems: [{ id: "user_1" }],
			join: joinPlan,
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		expect(sendCalls.length).toBe(1);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});

	test("respects join limits for one-to-many joins", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return {
						Items: [
							{ userId: "user_1", id: "session_1" },
							{ userId: "user_1", id: "session_2" },
							{ userId: "user_1", id: "session_3" },
						],
						LastEvaluatedKey: undefined,
					};
				}
				return {};
			},
		});
		const adapterConfig: DynamoDBAdapterConfig = {
			documentClient,
			usePlural: false,
			debugLogs: undefined,
			tableNamePrefix: "",
			tableNameResolver: (model) => model,
			scanMaxPages: 2,
			indexNameResolver,
			transaction: false,
		};
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const joinPlan: JoinPlan = {
			modelKey: "session",
			model: "session",
			relation: "one-to-many",
			on: { from: "id", to: userIdField },
			limit: 1,
			select: undefined,
			strategy: { kind: "query", key: "gsi", indexName: "session_userId_idx" },
		};

		const result = await executeJoin({
			baseItems: [{ id: "user_1" }],
			join: joinPlan,
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const joined = result[0]?.session;
		expect(Array.isArray(joined)).toBe(true);
		expect((joined as unknown[]).length).toBe(1);
	});

	test("returns a single item for one-to-one joins", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return {
						Items: [
							{ userId: "user_1", id: "session_1" },
							{ userId: "user_1", id: "session_2" },
						],
						LastEvaluatedKey: undefined,
					};
				}
				return {};
			},
		});
		const adapterConfig: DynamoDBAdapterConfig = {
			documentClient,
			usePlural: false,
			debugLogs: undefined,
			tableNamePrefix: "",
			tableNameResolver: (model) => model,
			scanMaxPages: 2,
			indexNameResolver,
			transaction: false,
		};
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const joinPlan: JoinPlan = {
			modelKey: "session",
			model: "session",
			relation: "one-to-one",
			on: { from: "id", to: userIdField },
			limit: 10,
			select: undefined,
			strategy: { kind: "query", key: "gsi", indexName: "session_userId_idx" },
		};

		const result = await executeJoin({
			baseItems: [{ id: "user_1" }],
			join: joinPlan,
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		const joined = result[0]?.session;
		expect(Array.isArray(joined)).toBe(false);
		expect(joined).toMatchObject({ userId: "user_1" });
	});
});
