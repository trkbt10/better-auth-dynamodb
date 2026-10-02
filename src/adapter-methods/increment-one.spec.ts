/**
 * @file Tests for the increment-one adapter method (request shapes and retries).
 */
import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { createDocumentClientStub } from "../../spec/dynamodb-document-client";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { createTransactionState } from "../dynamodb/ops/transaction";
import { MAX_ATOMIC_WRITE_ATTEMPTS } from "./atomic-write";
import { createIncrementOneMethod } from "./increment-one";

describe("createIncrementOneMethod", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;

	const buildAdapterConfig = (
		documentClient: ResolvedDynamoDBAdapterConfig["documentClient"],
		indexNameResolver: ResolvedDynamoDBAdapterConfig["indexNameResolver"] = () =>
			undefined,
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
		indexNameResolver,
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
		const incrementOne = createIncrementOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient),
				getFieldName,
				getDefaultModelName,
			},
		);
		return { incrementOne, sendCalls };
	};

	test("reads the pinned row consistently and updates it under the guard", async () => {
		const { incrementOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "t1", memberCount: 2 } };
			}
			if (command instanceof UpdateCommand) {
				return { Attributes: { id: "t1", memberCount: 3 } };
			}
			return {};
		});

		const updated = await incrementOne({
			model: "team",
			where: [
				{ field: "id", value: "t1" },
				{ field: "memberCount", operator: "lt", value: 5 },
			],
			increment: { memberCount: 1 },
		});

		expect(updated).toEqual({ id: "t1", memberCount: 3 });
		const [read, write] = sendCalls;
		expect(sendCalls).toHaveLength(2);
		expect(read).toBeInstanceOf(GetCommand);
		if (read instanceof GetCommand) {
			expect(read.input).toEqual({
				TableName: "team",
				Key: { id: "t1" },
				ConsistentRead: true,
			});
		}
		expect(write).toBeInstanceOf(UpdateCommand);
		if (write instanceof UpdateCommand) {
			expect(write.input).toEqual({
				TableName: "team",
				Key: { id: "t1" },
				UpdateExpression: "SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
				ConditionExpression:
					"attribute_exists(#pk) AND (#f0 = :v0 AND #f1 < :v1) AND (attribute_not_exists(#inc0) OR attribute_type(#inc0, :numberType))",
				ExpressionAttributeNames: {
					"#pk": "id",
					"#f0": "id",
					"#f1": "memberCount",
					"#inc0": "memberCount",
				},
				ExpressionAttributeValues: {
					":v0": "t1",
					":v1": 5,
					":inc0": 1,
					":zero": 0,
					":numberType": "N",
				},
				ReturnValues: "ALL_NEW",
			});
		}
	});

	test("returns null without writing when the guard does not match the row", async () => {
		const { incrementOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "t1", memberCount: 5 } };
			}
			return {};
		});

		const updated = await incrementOne({
			model: "team",
			where: [
				{ field: "id", value: "t1" },
				{ field: "memberCount", operator: "lt", value: 5 },
			],
			increment: { memberCount: 1 },
		});

		expect(updated).toBeNull();
		expect(sendCalls.some((call) => call instanceof UpdateCommand)).toBe(false);
	});

	test("returns null when the row does not exist", async () => {
		const { incrementOne } = createMethod(async () => ({}));

		const updated = await incrementOne({
			model: "team",
			where: [{ field: "id", value: "missing" }],
			increment: { memberCount: 1 },
		});

		expect(updated).toBeNull();
	});

	test("selects the row through an index when the key is not pinned", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "r1", key: "ip", count: 1 }] };
				}
				if (command instanceof UpdateCommand) {
					return { Attributes: { id: "r1", key: "ip", count: 2 } };
				}
				return {};
			},
		});
		const incrementOne = createIncrementOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient, (props) => {
					if (props.field === "key") {
						return "rateLimit_key_idx";
					}
					return undefined;
				}),
				getFieldName,
				getDefaultModelName,
			},
		);

		const updated = await incrementOne({
			model: "rateLimit",
			where: [
				{ field: "key", value: "ip" },
				{ field: "count", operator: "lt", value: 3 },
			],
			increment: { count: 1 },
			set: { lastRequest: 100 },
		});

		expect(updated).toEqual({ id: "r1", key: "ip", count: 2 });
		const [read, write] = sendCalls;
		expect(read).toBeInstanceOf(QueryCommand);
		expect(write).toBeInstanceOf(UpdateCommand);
		if (write instanceof UpdateCommand) {
			expect(write.input.Key).toEqual({ id: "r1" });
			expect(write.input.UpdateExpression).toBe(
				"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0, #set0 = :set0",
			);
			expect(write.input.ConditionExpression).toBe(
				"attribute_exists(#pk) AND (#f0 = :v0 AND #f1 < :v1) AND (attribute_not_exists(#inc0) OR attribute_type(#inc0, :numberType))",
			);
		}
	});

	test("returns the matching row untouched when nothing is assigned", async () => {
		const { incrementOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "t1", memberCount: 2 } };
			}
			return {};
		});

		const updated = await incrementOne({
			model: "team",
			where: [{ field: "id", value: "t1" }],
			increment: {},
			set: { ignored: undefined },
		});

		expect(updated).toEqual({ id: "t1", memberCount: 2 });
		expect(sendCalls.some((call) => call instanceof UpdateCommand)).toBe(false);
	});

	test("re-reads the row after a failed condition and applies the fresh expression", async () => {
		const reads = [
			{ id: "t1", memberCount: 2 },
			{ id: "t1", memberCount: null },
		];
		const { incrementOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: reads.shift() };
			}
			if (command instanceof UpdateCommand) {
				if (command.input.UpdateExpression === "SET #inc0 = :inc0") {
					return { Attributes: { id: "t1", memberCount: 1 } };
				}
				throw conditionalCheckFailure();
			}
			return {};
		});

		const updated = await incrementOne({
			model: "team",
			where: [{ field: "id", value: "t1" }],
			increment: { memberCount: 1 },
		});

		expect(updated).toEqual({ id: "t1", memberCount: 1 });
		expect(sendCalls.map((call) => call?.constructor.name)).toEqual([
			"GetCommand",
			"UpdateCommand",
			"GetCommand",
			"UpdateCommand",
		]);
	});

	test("returns null when the row found through an index no longer matches", async () => {
		// The index still lists the counter below the limit; the row itself is at it.
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "r1", key: "ip", count: 1 }] };
				}
				if (command instanceof GetCommand) {
					return { Item: { id: "r1", key: "ip", count: 2 } };
				}
				throw conditionalCheckFailure();
			},
		});
		const incrementOne = createIncrementOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient, (props) => {
					if (props.field === "key") {
						return "rateLimit_key_idx";
					}
					return undefined;
				}),
				getFieldName,
				getDefaultModelName,
			},
		);

		const updated = await incrementOne({
			model: "rateLimit",
			where: [
				{ field: "key", value: "ip" },
				{ field: "count", operator: "lt", value: 2 },
			],
			increment: { count: 1 },
		});

		expect(updated).toBeNull();
		expect(sendCalls.map((call) => call?.constructor.name)).toEqual([
			"QueryCommand",
			"UpdateCommand",
			"GetCommand",
			"QueryCommand",
		]);
	});

	test("gives up with an error when the condition keeps failing", async () => {
		const { incrementOne, sendCalls } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "t1", memberCount: 2 } };
			}
			throw conditionalCheckFailure();
		});

		const error = await captureAsyncError(() =>
			incrementOne({
				model: "team",
				where: [{ field: "id", value: "t1" }],
				increment: { memberCount: 1 },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("ATOMIC_WRITE_CONTENTION");
		}
		expect(
			sendCalls.filter((call) => call instanceof UpdateCommand),
		).toHaveLength(MAX_ATOMIC_WRITE_ATTEMPTS);
	});

	test("propagates errors other than a failed condition", async () => {
		const { incrementOne } = createMethod(async (command) => {
			if (command instanceof GetCommand) {
				return { Item: { id: "t1", memberCount: 2 } };
			}
			throw new Error("ThrottlingException");
		});

		const error = await captureAsyncError(() =>
			incrementOne({
				model: "team",
				where: [{ field: "id", value: "t1" }],
				increment: { memberCount: 1 },
			}),
		);

		expect(error).toBeInstanceOf(Error);
		if (error instanceof Error) {
			expect(error.message).toBe("ThrottlingException");
		}
	});

	test("buffers a pinned update and returns the computed row inside a transaction", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof GetCommand) {
					return { Item: { id: "t1", memberCount: 2, name: "team" } };
				}
				return {};
			},
		});
		const transactionState = createTransactionState();
		const incrementOne = createIncrementOneMethod(
			{ documentClient },
			{
				adapterConfig: buildAdapterConfig(documentClient),
				getFieldName,
				getDefaultModelName,
				transactionState,
			},
		);

		const updated = await incrementOne({
			model: "team",
			where: [
				{ field: "id", value: "t1" },
				{ field: "memberCount", operator: "lt", value: 5 },
			],
			increment: { memberCount: 1 },
			set: { name: "renamed" },
		});

		expect(updated).toEqual({ id: "t1", memberCount: 3, name: "renamed" });
		expect(sendCalls.some((call) => call instanceof UpdateCommand)).toBe(false);
		expect(transactionState.items).toEqual([
			{
				tableName: "team",
				keyField: "id",
				key: { id: "t1" },
				base: { id: "t1", memberCount: 2, name: "team" },
				current: { id: "t1", memberCount: 3, name: "renamed" },
				pinnedFields: ["id", "memberCount"],
			},
		]);
	});
});
