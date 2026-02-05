/**
 * @file Tests for query plan execution behavior.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { getAuthTables } from "@better-auth/core/db";
import {
	initGetDefaultModelName,
	initGetFieldName,
} from "@better-auth/core/db/adapter";
import {
	QueryCommand,
	ScanCommand,
	type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { createQueryPlanExecutor } from "./execute-query-plan";
import { buildQueryPlan } from "../planner/build-query-plan";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import type { DynamoDBAdapterConfig } from "../../adapter";

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
	if (props.model === "user" && props.field === "email") {
		return "user_email_idx";
	}
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	if (props.model === "session" && props.field === "token") {
		return "session_token_idx";
	}
	if (props.model === "account" && props.field === "accountId") {
		return "account_accountId_idx";
	}
	if (props.model === "account" && props.field === "providerId") {
		return "account_providerId_accountId_idx";
	}
	if (props.model === "verification" && props.field === "identifier") {
		return "verification_identifier_idx";
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
	if (
		props.model === "verification" &&
		props.indexName === "verification_identifier_idx"
	) {
		return { partitionKey: "identifier", sortKey: "createdAt" };
	}
	if (
		props.model === "account" &&
		props.indexName === "account_providerId_accountId_idx"
	) {
		return { partitionKey: "providerId", sortKey: "accountId" };
	}
	return undefined;
};

const buildAdapterConfig = (documentClient: DynamoDBDocumentClient): DynamoDBAdapterConfig => ({
	documentClient,
	usePlural: false,
	debugLogs: undefined,
	tableNamePrefix: "",
	tableNameResolver: (model) => model,
	scanMaxPages: 2,
	indexNameResolver,
	indexKeySchemaResolver,
	transaction: false,
});

describe("execute query plan", () => {
	const helpers = buildSchemaHelpers();

	test("uses QueryCommand with GSI for indexed fields", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const plan = buildQueryPlan({
			model: "session",
			where: [
				{
					field: userIdField,
					operator: "eq",
					value: "user_1",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("session_userId_idx");
	});

	test("uses QueryCommand with GSI for user email lookups", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const emailField = helpers.getFieldName({ model: "user", field: "email" });
		const plan = buildQueryPlan({
			model: "user",
			where: [
				{
					field: emailField,
					operator: "eq",
					value: "a@example.com",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 1,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("user_email_idx");
	});

	test("uses QueryCommand with GSI for accountId lookups", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const accountIdField = helpers.getFieldName({
			model: "account",
			field: "accountId",
		});
		const plan = buildQueryPlan({
			model: "account",
			where: [
				{
					field: accountIdField,
					operator: "eq",
					value: "account_1",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("account_accountId_idx");
	});

	test("prefers composite GSI when providerId+accountId are both present", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const accountIdField = helpers.getFieldName({
			model: "account",
			field: "accountId",
		});
		const providerIdField = helpers.getFieldName({
			model: "account",
			field: "providerId",
		});
		const plan = buildQueryPlan({
			model: "account",
			where: [
				{
					field: accountIdField,
					operator: "eq",
					value: "account_1",
				},
				{
					field: providerIdField,
					operator: "eq",
					value: "github",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("account_providerId_accountId_idx");
		expect(command.input.KeyConditionExpression).toBe("#pk = :pk AND #sk = :sk");
	});

	test("uses ScanCommand for OR connector queries", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const emailField = helpers.getFieldName({ model: "user", field: "email" });
		const plan = buildQueryPlan({
			model: "user",
			where: [
				{
					field: emailField,
					operator: "eq",
					value: "a@example.com",
					connector: "OR",
				},
				{
					field: emailField,
					operator: "eq",
					value: "b@example.com",
					connector: "OR",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as ScanCommand;
		expect(command).toBeInstanceOf(ScanCommand);
	});

	test("uses QueryCommand when PK condition is AND and OR filters exist", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const idField = helpers.getFieldName({ model: "user", field: "id" });
		const emailField = helpers.getFieldName({ model: "user", field: "email" });
		const plan = buildQueryPlan({
			model: "user",
			where: [
				{
					field: idField,
					operator: "eq",
					value: "user_1",
				},
				{
					field: emailField,
					operator: "eq",
					value: "a@example.com",
					connector: "OR",
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
	});

	test("sets ScanIndexForward when sortBy matches index sort key", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const identifierField = helpers.getFieldName({
			model: "verification",
			field: "identifier",
		});
		const plan = buildQueryPlan({
			model: "verification",
			where: [
				{
					field: identifierField,
					operator: "eq",
					value: "user@example.com",
				},
			],
			select: undefined,
			sortBy: {
				field: "createdAt",
				direction: "desc",
			},
			limit: 1,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		const command = sendCalls[0] as QueryCommand;
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.ScanIndexForward).toBe(false);
	});

	test("uses multi-query for indexed IN lookups", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const tokenField = helpers.getFieldName({
			model: "session",
			field: "token",
		});
		const plan = buildQueryPlan({
			model: "session",
			where: [
				{
					field: tokenField,
					operator: "in",
					value: ["token_1", "token_2"],
				},
			],
			select: undefined,
			sortBy: undefined,
			limit: 5,
			offset: 0,
			join: undefined,
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver, indexKeySchemaResolver },
		});

		const executePlan = createQueryPlanExecutor({
			documentClient,
			adapterConfig,
			getFieldName: helpers.getFieldName,
			getDefaultModelName: helpers.getDefaultModelName,
		});

		await executePlan(plan);

		expect(sendCalls.length).toBe(2);
		expect(sendCalls.every((command) => command instanceof QueryCommand)).toBe(
			true,
		);
	});
});
