/**
 * @file Tests for DynamoDB scan helpers.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { scanCount, scanItems } from "./scan-command";

describe("scanItems", () => {
	test("paginates until exhaustion", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown, callIndex: number) => {
				if (command instanceof ScanCommand) {
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

		const items = await scanItems({
			documentClient,
			tableName: "users",
			filterExpression: undefined,
			expressionAttributeNames: {},
			expressionAttributeValues: {},
		});

		expect(items).toEqual([{ id: "1" }, { id: "2" }]);
		expect(sendCalls.length).toBe(2);

		const firstCall = sendCalls[0];
		const secondCall = sendCalls[1];
		if (firstCall instanceof ScanCommand) {
			const input = firstCall.input;
			expect(input.TableName).toBe("users");
		}
		if (secondCall instanceof ScanCommand) {
			const input = secondCall.input;
			expect(input.ExclusiveStartKey).toEqual({ id: "1" });
		}
	});

	test("honors limit on first page", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({ Items: [{ id: "1" }] }),
		});

		const items = await scanItems({
			documentClient,
			tableName: "users",
			filterExpression: undefined,
			expressionAttributeNames: {},
			expressionAttributeValues: {},
			limit: 1,
		});

		expect(items).toEqual([{ id: "1" }]);
		expect(sendCalls.length).toBe(1);

		const call = sendCalls[0];
		if (call instanceof ScanCommand) {
			const input = call.input;
			expect(input.Limit).toBe(1);
		}
	});
});

describe("scanCount", () => {
	test("sums count across pages", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command: unknown, callIndex: number) => {
				if (command instanceof ScanCommand) {
					if (callIndex === 0) {
						return { Count: 2, LastEvaluatedKey: { id: "2" } };
					}
					return { Count: 1 };
				}
				return {};
			},
		});

		const count = await scanCount({
			documentClient,
			tableName: "users",
			filterExpression: undefined,
			expressionAttributeNames: {},
			expressionAttributeValues: {},
		});

		expect(count).toBe(3);
	});
});
