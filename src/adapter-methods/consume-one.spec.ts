/**
 * @file Tests for the consume-one adapter method (request shapes and retries).
 */
import {
	DeleteCommand,
	GetCommand,
	QueryCommand,
	ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { createDocumentClientStub } from "../../spec/dynamodb-document-client";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { createTransactionState } from "../dynamodb/ops/transaction";
import { MAX_ATOMIC_WRITE_ATTEMPTS } from "./atomic-write";
import { createConsumeOneMethod } from "./consume-one";

describe("createConsumeOneMethod", () => {
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
		explainDynamoOperations: false,
		indexNameResolver: () => undefined,
		indexKeySchemaResolver: undefined,
		transaction: false,
	});

	const conditionalCheckFailure = (): Error => {
		const error = new Error("The conditional request failed");
		error.name = "ConditionalCheckFailedException";
		return error;
	};

	const captureAsyncError = async (fn: () => Promise<unknown>): Promise<unknown> => {
		try {
			await fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	const createMethod = (
		respond: (command: unknown, callIndex: number) => Promise<unknown>,
	) => {
		const { documentClient, sendCalls } = createDocumentClientStub({ respond });
		const consumeOne = createConsumeOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient),
				getFieldName,
				getDefaultModelName,
			},
		);
		return { consumeOne, sendCalls };
	};

	test("consumes a row selected by primary key with a single conditional DeleteItem", async () => {
		const { consumeOne, sendCalls } = createMethod(async () => ({
			Attributes: { id: "v1", value: "secret" },
		}));

		const consumed = await consumeOne({
			model: "verification",
			where: [
				{ field: "id", value: "v1" },
				{ field: "value", value: "secret" },
			],
		});

		expect(consumed).toEqual({ id: "v1", value: "secret" });
		expect(sendCalls).toHaveLength(1);
		const command = sendCalls[0];
		expect(command).toBeInstanceOf(DeleteCommand);
		if (command instanceof DeleteCommand) {
			expect(command.input).toEqual({
				TableName: "verification",
				Key: { id: "v1" },
				ConditionExpression:
					"attribute_exists(#pk) AND (#f0 = :v0 AND #f1 = :v1)",
				ExpressionAttributeNames: { "#pk": "id", "#f0": "id", "#f1": "value" },
				ExpressionAttributeValues: { ":v0": "v1", ":v1": "secret" },
				ReturnValues: "ALL_OLD",
			});
		}
	});

	test("returns null when the conditional delete finds nothing to consume", async () => {
		const { consumeOne, sendCalls } = createMethod(async () => {
			throw conditionalCheckFailure();
		});

		const consumed = await consumeOne({
			model: "verification",
			where: [{ field: "id", value: "v1" }],
		});

		expect(consumed).toBeNull();
		expect(sendCalls).toHaveLength(1);
	});

	test("returns null without a request when the primary key value is null", async () => {
		const { consumeOne, sendCalls } = createMethod(async () => ({}));

		const consumed = await consumeOne({
			model: "verification",
			where: [{ field: "id", value: null }],
		});

		expect(consumed).toBeNull();
		expect(sendCalls).toHaveLength(0);
	});

	test("propagates errors other than a failed condition", async () => {
		const { consumeOne } = createMethod(async () => {
			throw new Error("ProvisionedThroughputExceededException");
		});

		const error = await captureAsyncError(() =>
			consumeOne({
				model: "verification",
				where: [{ field: "id", value: "v1" }],
			}),
		);

		expect(error).toBeInstanceOf(Error);
		if (error instanceof Error) {
			expect(error.message).toBe("ProvisionedThroughputExceededException");
		}
	});

	test("resolves the key first when the where clause does not pin it", async () => {
		const { consumeOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof ScanCommand) {
				return { Items: [{ id: "v9", identifier: "token" }] };
			}
			if (command instanceof DeleteCommand) {
				return { Attributes: { id: "v9", identifier: "token" } };
			}
			return {};
		});

		const consumed = await consumeOne({
			model: "verification",
			where: [{ field: "identifier", value: "token" }],
		});

		expect(consumed).toEqual({ id: "v9", identifier: "token" });
		expect(sendCalls.map((call) => call?.constructor.name)).toEqual([
			"ScanCommand",
			"DeleteCommand",
		]);
		const command = sendCalls[1];
		if (command instanceof DeleteCommand) {
			expect(command.input.Key).toEqual({ id: "v9" });
			expect(command.input.ConditionExpression).toBe(
				"attribute_exists(#pk) AND (#f0 = :v0)",
			);
		}
	});

	test("reads the pinned row consistently when DynamoDB cannot evaluate the where clause", async () => {
		const { consumeOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "v1", identifier: "abc-xyz" } };
			}
			if (command instanceof DeleteCommand) {
				return { Attributes: { id: "v1", identifier: "abc-xyz" } };
			}
			return {};
		});

		const consumed = await consumeOne({
			model: "verification",
			where: [
				{ field: "id", value: "v1" },
				{ field: "identifier", operator: "ends_with", value: "-xyz" },
			],
		});

		expect(consumed).toEqual({ id: "v1", identifier: "abc-xyz" });
		const [read, write] = sendCalls;
		expect(read).toBeInstanceOf(GetCommand);
		if (read instanceof GetCommand) {
			expect(read.input).toEqual({
				TableName: "verification",
				Key: { id: "v1" },
				ConsistentRead: true,
			});
		}
		expect(write).toBeInstanceOf(DeleteCommand);
		if (write instanceof DeleteCommand) {
			expect(write.input.ConditionExpression).toBe(
				"attribute_exists(#pk) AND #pin0 = :pin0 AND #pin1 = :pin1",
			);
		}
		expect(sendCalls.some((call) => call instanceof QueryCommand)).toBe(false);
	});

	test("retries with a fresh read after a failed condition, then gives up with an error", async () => {
		const { consumeOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof ScanCommand) {
				return { Items: [{ id: "v9", identifier: "token" }] };
			}
			throw conditionalCheckFailure();
		});

		const error = await captureAsyncError(() =>
			consumeOne({
				model: "verification",
				where: [{ field: "identifier", value: "token" }],
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("ATOMIC_WRITE_CONTENTION");
		}
		expect(
			sendCalls.filter((call) => call instanceof DeleteCommand),
		).toHaveLength(MAX_ATOMIC_WRITE_ATTEMPTS);
		expect(
			sendCalls.filter((call) => call instanceof ScanCommand),
		).toHaveLength(MAX_ATOMIC_WRITE_ATTEMPTS);
	});

	test("buffers a conditional delete and returns the snapshot inside a transaction", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof GetCommand) {
					return { Item: { id: "v1", value: "secret" } };
				}
				return {};
			},
		});
		const transactionState = createTransactionState();
		const consumeOne = createConsumeOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient),
				getFieldName,
				getDefaultModelName,
				transactionState,
			},
		);
		const where = [{ field: "id", value: "v1" }];

		const first = await consumeOne({ model: "verification", where });
		const second = await consumeOne({ model: "verification", where });

		expect(first).toEqual({ id: "v1", value: "secret" });
		expect(second).toBeNull();
		expect(sendCalls.some((call) => call instanceof DeleteCommand)).toBe(false);
		expect(transactionState.operations).toEqual([
			{
				kind: "delete",
				tableName: "verification",
				key: { id: "v1" },
				condition: {
					conditionExpression:
						"attribute_exists(#pk) AND (#f0 = :v0) AND #pin0 = :pin0 AND #pin1 = :pin1",
					expressionAttributeNames: {
						"#pk": "id",
						"#f0": "id",
						"#pin0": "id",
						"#pin1": "value",
					},
					expressionAttributeValues: {
						":v0": "v1",
						":pin0": "v1",
						":pin1": "secret",
					},
				},
			},
		]);
	});
});
