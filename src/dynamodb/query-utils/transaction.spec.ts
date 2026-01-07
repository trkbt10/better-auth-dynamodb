/**
 * @file Tests for DynamoDB transaction helpers.
 */
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import {
	addTransactionOperation,
	createTransactionState,
	executeTransaction,
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
});
