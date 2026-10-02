/**
 * @file Tests for DynamoDB transaction helpers.
 */
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import {
	addTransactionOperation,
	createTransactionState,
	executeTransaction,
	hasBufferedDelete,
} from "./transaction";
import { DynamoDBAdapterError } from "../errors/errors";

describe("transaction helpers", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("enforces transaction limit", () => {
		const state = createTransactionState();
		const operations = Array.from({ length: 25 }, () => ({
			kind: "put" as const,
			tableName: "users",
			item: { id: "user" },
		}));

		operations.forEach((operation) => {
			addTransactionOperation(state, operation);
		});

		const error = captureError(() =>
			addTransactionOperation(state, {
				kind: "put",
				tableName: "users",
				item: { id: "overflow" },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("TRANSACTION_LIMIT");
		}
	});

	test("executes transact write", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "users",
			item: { id: "user-1" },
		});

		await executeTransaction({ documentClient, state });

		expect(sendCalls.length).toBe(1);
		expect(sendCalls[0]).toBeInstanceOf(TransactWriteCommand);
	});

	test("sends the condition of a buffered delete and update", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "verification",
			key: { id: "v1" },
			condition: {
				conditionExpression: "attribute_exists(#pk)",
				expressionAttributeNames: { "#pk": "id" },
				expressionAttributeValues: {},
			},
		});
		addTransactionOperation(state, {
			kind: "update",
			tableName: "team",
			key: { id: "t1" },
			updateExpression: "SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
			expressionAttributeNames: { "#inc0": "memberCount" },
			expressionAttributeValues: { ":inc0": 1, ":zero": 0 },
			condition: {
				conditionExpression: "attribute_exists(#pk) AND #pin0 = :pin0",
				expressionAttributeNames: { "#pk": "id", "#pin0": "memberCount" },
				expressionAttributeValues: { ":pin0": 2 },
			},
		});
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "session",
			key: { id: "s1" },
		});

		await executeTransaction({ documentClient, state });

		const command = sendCalls[0];
		expect(command).toBeInstanceOf(TransactWriteCommand);
		if (command instanceof TransactWriteCommand) {
			expect(command.input.TransactItems).toEqual([
				{
					Delete: {
						TableName: "verification",
						Key: { id: "v1" },
						ConditionExpression: "attribute_exists(#pk)",
						ExpressionAttributeNames: { "#pk": "id" },
					},
				},
				{
					Update: {
						TableName: "team",
						Key: { id: "t1" },
						UpdateExpression:
							"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
						ConditionExpression: "attribute_exists(#pk) AND #pin0 = :pin0",
						ExpressionAttributeNames: {
							"#inc0": "memberCount",
							"#pk": "id",
							"#pin0": "memberCount",
						},
						ExpressionAttributeValues: {
							":inc0": 1,
							":zero": 0,
							":pin0": 2,
						},
					},
				},
				{
					Delete: {
						TableName: "session",
						Key: { id: "s1" },
					},
				},
			]);
		}
	});

	test("drops a delete of an item the transaction already deletes", () => {
		const state = createTransactionState();
		const condition = {
			conditionExpression: "attribute_exists(#pk)",
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: {},
		};
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "verification",
			key: { id: "v1" },
			condition,
		});
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "verification",
			key: { id: "v1" },
		});
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "verification",
			key: { id: "v2" },
		});
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "session",
			key: { id: "v1" },
		});

		expect(state.operations).toEqual([
			{ kind: "delete", tableName: "verification", key: { id: "v1" }, condition },
			{ kind: "delete", tableName: "verification", key: { id: "v2" } },
			{ kind: "delete", tableName: "session", key: { id: "v1" } },
		]);
		expect(
			hasBufferedDelete(state, { tableName: "verification", key: { id: "v1" } }),
		).toBe(true);
		expect(
			hasBufferedDelete(state, { tableName: "verification", key: { id: "v3" } }),
		).toBe(false);
	});
});
