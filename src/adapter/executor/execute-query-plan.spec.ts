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
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
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
			adapterConfig: { indexNameResolver },
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
			adapterConfig: { indexNameResolver },
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
});
