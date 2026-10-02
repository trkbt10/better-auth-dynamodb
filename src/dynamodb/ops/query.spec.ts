/**
 * @file Tests for DynamoDB query helpers.
 */
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { queryCount, queryItems } from "./query";

for (const query of [queryItems, queryCount]) {
  test.each([
    { indexName: undefined, consistentRead: true, expected: true },
    { indexName: undefined, consistentRead: undefined, expected: undefined },
    { indexName: "counter_key_idx", consistentRead: true, expected: undefined },
  ])(`${query.name} only requests strong reads on an explicitly configured table query: %j`, async (settings) => {
    const { documentClient, sendCalls } = createDocumentClientStub({ respond: async () => ({ Items: [], Count: 0 }) });
    await query({
      documentClient,
      tableName: "counter",
      indexName: settings.indexName,
      consistentRead: settings.consistentRead,
      keyConditionExpression: "#pk = :pk",
      filterExpression: undefined,
      expressionAttributeNames: { "#pk": "id" },
      expressionAttributeValues: { ":pk": "1" },
    });
    expect(sendCalls).toHaveLength(1);
    const command = sendCalls[0];
    if (!(command instanceof QueryCommand)) {
      throw new Error("Expected a DynamoDB query.");
    }
    expect(command.input.ConsistentRead).toBe(settings.expected);
  });
}

describe("queryItems", () => {
	test("reads full pages when a filter is applied and trims the result", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({
				Items: [{ id: "1" }, { id: "2" }, { id: "3" }],
				LastEvaluatedKey: { id: "3" },
			}),
		});

		const filtered = await queryItems({
			documentClient,
			tableName: "sessions",
			keyConditionExpression: "#pk = :pk",
			filterExpression: "#f0 = :v0",
			expressionAttributeNames: { "#pk": "userId", "#f0": "kind" },
			expressionAttributeValues: { ":pk": "u1", ":v0": "a" },
			limit: 2,
		});
		const unfiltered = await queryItems({
			documentClient,
			tableName: "sessions",
			keyConditionExpression: "#pk = :pk",
			filterExpression: undefined,
			expressionAttributeNames: { "#pk": "userId" },
			expressionAttributeValues: { ":pk": "u1" },
			limit: 2,
		});

		expect(filtered).toEqual([{ id: "1" }, { id: "2" }]);
		expect(unfiltered).toEqual([{ id: "1" }, { id: "2" }]);
		expect(sendCalls).toHaveLength(2);
		const [withFilter, withoutFilter] = sendCalls;
		if (withFilter instanceof QueryCommand && withoutFilter instanceof QueryCommand) {
			expect(withFilter.input.Limit).toBeUndefined();
			expect(withoutFilter.input.Limit).toBe(2);
		}
	});

	test("paginates until exhaustion", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown, callIndex: number) => {
				if (command instanceof QueryCommand) {
					if (callIndex === 0) {
						return {
							Items: [{ id: "1" }],
							LastEvaluatedKey: { id: "1" },
						};
					}
					return { Items: [{ id: "2" }] };
				}
				return {};
			},
		});

		const items = await queryItems({
			documentClient,
			tableName: "users",
			keyConditionExpression: "#pk = :pk",
			filterExpression: undefined,
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: { ":pk": "1" },
		});

		expect(items).toEqual([{ id: "1" }, { id: "2" }]);
		expect(sendCalls.length).toBe(2);

		const firstCall = sendCalls[0];
		const secondCall = sendCalls[1];
		if (firstCall instanceof QueryCommand) {
			const input = firstCall.input;
			expect(input.TableName).toBe("users");
		}
		if (secondCall instanceof QueryCommand) {
			const input = secondCall.input;
			expect(input.ExclusiveStartKey).toEqual({ id: "1" });
		}
	});

	test("honors limit on first page", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({ Items: [{ id: "1" }] }),
		});

		const items = await queryItems({
			documentClient,
			tableName: "users",
			keyConditionExpression: "#pk = :pk",
			filterExpression: undefined,
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: { ":pk": "1" },
			limit: 1,
		});

		expect(items).toEqual([{ id: "1" }]);
		expect(sendCalls.length).toBe(1);

		const call = sendCalls[0];
		if (call instanceof QueryCommand) {
			const input = call.input;
			expect(input.Limit).toBe(1);
		}
	});
});

describe("queryCount", () => {
	test("sums count across pages", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command: unknown, callIndex: number) => {
				if (command instanceof QueryCommand) {
					if (callIndex === 0) {
						return { Count: 2, LastEvaluatedKey: { id: "2" } };
					}
					return { Count: 1 };
				}
				return {};
			},
		});

		const count = await queryCount({
			documentClient,
			tableName: "users",
			keyConditionExpression: "#pk = :pk",
			filterExpression: undefined,
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: { ":pk": "1" },
		});

		expect(count).toBe(3);
	});
});
