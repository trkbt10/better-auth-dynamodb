/**
 * @file Tests for find-one adapter method batching behavior.
 */
import { BatchGetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { createPrimaryKeyBatchLoader } from "../adapter/batching/primary-key-batch-loader";
import { createFindOneMethod } from "./find-one";
import { createDocumentClientStub } from "../../spec/dynamodb-document-client";

describe("createFindOneMethod", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;

	const buildAdapterConfig = (
		documentClient: ResolvedDynamoDBAdapterConfig["documentClient"],
	): ResolvedDynamoDBAdapterConfig => ({
		documentClient,
		usePlural: false,
		debugLogs: undefined,
		tableNamePrefix: "",
		tableNameResolver: (model) => model,
		scanMaxPages: 1,
		scanPageLimitMode: "throw",
		explainQueryPlans: false,
		indexNameResolver: () => undefined,
		indexKeySchemaResolver: undefined,
		transaction: false,
	});

	test("batches concurrent id lookups into BatchGetCommand", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof BatchGetCommand) {
					return {
						Responses: {
							user: [{ id: "u1" }, { id: "u2" }],
						},
					};
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const primaryKeyLoader = createPrimaryKeyBatchLoader({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});
		const findOne = createFindOneMethod(
			{ documentClient },
			{
				adapterConfig,
				getFieldName,
				getDefaultModelName,
				primaryKeyLoader,
			},
		);

		const [first, second] = await Promise.all([
			findOne<{ id: string }>({
				model: "user",
				where: [{ field: "id", operator: "eq", value: "u1" }],
			}),
			findOne<{ id: string }>({
				model: "user",
				where: [{ field: "id", operator: "eq", value: "u2" }],
			}),
		]);

		expect(first).toEqual({ id: "u1" });
		expect(second).toEqual({ id: "u2" });
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]).toBeInstanceOf(BatchGetCommand);
		expect(sendCalls.some((call) => call instanceof QueryCommand)).toBe(false);
	});

	test("falls back to QueryCommand when select is provided", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "u1" }], LastEvaluatedKey: undefined };
				}
				return {};
			},
		});
		const adapterConfig = buildAdapterConfig(documentClient);
		const primaryKeyLoader = createPrimaryKeyBatchLoader({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});
		const findOne = createFindOneMethod(
			{ documentClient },
			{
				adapterConfig,
				getFieldName,
				getDefaultModelName,
				primaryKeyLoader,
			},
		);

		const result = await findOne<{ id: string }>({
			model: "user",
			where: [{ field: "id", operator: "eq", value: "u1" }],
			select: ["id"],
		});

		expect(result).toEqual({ id: "u1" });
		expect(sendCalls.length).toBeGreaterThan(0);
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});
});
