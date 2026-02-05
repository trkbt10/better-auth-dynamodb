/**
 * @file Tests for DynamoDB batch-get helpers.
 */
import { BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { batchGetItems } from "./batch-get";
import { DynamoDBAdapterError } from "../errors/errors";

describe("batchGetItems", () => {
	test("returns empty array for empty keys", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: [],
		});

		expect(items).toEqual([]);
		expect(sendCalls.length).toBe(0);
	});

	test("fetches items by keys", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({
				Responses: {
					users: [{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }],
				},
			}),
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: ["1", "2"],
		});

		expect(items).toEqual([{ id: "1", name: "Alice" }, { id: "2", name: "Bob" }]);
		expect(sendCalls.length).toBe(1);
		expect(sendCalls[0]).toBeInstanceOf(BatchGetCommand);
	});

	test("chunks large key sets", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({
				Responses: { users: [] },
			}),
		});

		const keys = Array.from({ length: 150 }, (_, i) => `id_${i}`);
		await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys,
		});

		expect(sendCalls.length).toBe(2);
	});

	test("retries unprocessed keys", async () => {
		const state = { callCount: 0 };
		const { documentClient } = createDocumentClientStub({
			respond: async () => {
				state.callCount++;
				if (state.callCount === 1) {
					return {
						Responses: { users: [{ id: "1" }] },
						UnprocessedKeys: {
							users: { Keys: [{ id: "2" }] },
						},
					};
				}
				return {
					Responses: { users: [{ id: "2" }] },
				};
			},
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: ["1", "2"],
		});

		expect(items).toEqual([{ id: "1" }, { id: "2" }]);
		expect(state.callCount).toBe(2);
	});

	test("retries throttling errors with backoff", async () => {
		const state = { callCount: 0 };
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => {
				state.callCount += 1;
				if (state.callCount === 1) {
					const error = new Error("throttled");
					error.name = "ProvisionedThroughputExceededException";
					throw error;
				}
				return {
					Responses: { users: [{ id: "1" }] },
				};
			},
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: ["1"],
			maxAttempts: 3,
			backoffBaseDelayMs: 0,
			backoffMaxDelayMs: 0,
		});

		expect(items).toEqual([{ id: "1" }]);
		expect(state.callCount).toBe(2);
		expect(sendCalls).toHaveLength(2);
		expect(sendCalls[0]).toBeInstanceOf(BatchGetCommand);
		expect(sendCalls[1]).toBeInstanceOf(BatchGetCommand);
	});

	test("throws error after max retry attempts", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({
				Responses: { users: [] },
				UnprocessedKeys: {
					users: { Keys: [{ id: "1" }] },
				},
			}),
		});

		await expect(
			batchGetItems({
				documentClient,
				tableName: "users",
				keyField: "id",
				keys: ["1"],
			}),
		).rejects.toThrow(DynamoDBAdapterError);
	});

	test("handles empty response gracefully", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({
				Responses: {},
			}),
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: ["1"],
		});

		expect(items).toEqual([]);
	});

	test("handles undefined Responses gracefully", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({}),
		});

		const items = await batchGetItems({
			documentClient,
			tableName: "users",
			keyField: "id",
			keys: ["1"],
		});

		expect(items).toEqual([]);
	});
});
