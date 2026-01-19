/**
 * @file Repro tests for join fallback N+1 risk when experimental joins are disabled.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { BatchGetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "./dynamodb-document-client";
import { dynamodbAdapter } from "../src/adapter";
import { DynamoDBAdapterError } from "../src/dynamodb/errors/errors";

describe("fallback join batching", () => {
	test("coalesces fallback join user lookups into BatchGetCommand (sessions -> user)", async () => {
		const sessionCount = 25;

		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					const tableName = command.input.TableName;
					if (tableName === "auth_session") {
						const Items = Array.from({ length: sessionCount }, (_, index) => ({
							id: `session_${index}`,
							userId: `user_${index}`,
						}));
						return {
							Items,
							LastEvaluatedKey: undefined,
						};
					}
					return { Items: [], LastEvaluatedKey: undefined };
				}

				if (command instanceof BatchGetCommand) {
					const request = command.input.RequestItems?.["auth_user"];
					const keys = request?.Keys ?? [];
					const items = keys.map((key) => ({
						id: key.id,
					}));
					return { Responses: { auth_user: items } };
				}

				return {};
			},
		});

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
			indexNameResolver: () => undefined,
		});
		const options: BetterAuthOptions = {
			experimental: { joins: false },
		};
		const adapter = adapterFactory(options);

		const sessions = await adapter.findMany<{ user: { id: string } | null }>({
			model: "session",
			limit: sessionCount,
			join: { user: true },
		});

		expect(sessions).toHaveLength(sessionCount);
		expect(
			sessions.every((session) => {
				if (!session.user) {
					return false;
				}
				return typeof session.user.id === "string";
			}),
		).toBe(true);

		const scanCalls = sendCalls.filter((call) => call instanceof ScanCommand);
		const batchCalls = sendCalls.filter((call) => call instanceof BatchGetCommand);
		expect(scanCalls).toHaveLength(1);
		expect(batchCalls).toHaveLength(1);
	});

	test("chunks batch-get when fallback join needs many user ids", async () => {
		const sessionCount = 12_345;
		const explainQueryPlans = process.env.EXPLAIN_QUERY_PLANS === "1";

		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					const tableName = command.input.TableName;
					if (tableName === "auth_session") {
						const Items = Array.from({ length: sessionCount }, (_, index) => ({
							id: `session_${index}`,
							userId: `user_${index}`,
						}));
						return {
							Items,
							LastEvaluatedKey: undefined,
						};
					}
					return { Items: [], LastEvaluatedKey: undefined };
				}

				if (command instanceof BatchGetCommand) {
					const request = command.input.RequestItems?.["auth_user"];
					const keys = request?.Keys ?? [];
					const items = keys.map((key) => ({
						id: key.id,
					}));
					return { Responses: { auth_user: items } };
				}

				return {};
			},
		});

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
			explainQueryPlans,
			indexNameResolver: () => undefined,
		});
		const options: BetterAuthOptions = {
			experimental: { joins: false },
		};
		const adapter = adapterFactory(options);

		const sessions = await adapter.findMany<{ user: { id: string } | null }>({
			model: "session",
			limit: sessionCount,
			join: { user: true },
		});

		expect(sessions).toHaveLength(sessionCount);

		const expectedBatchGets = Math.ceil(sessionCount / 100);
		const scanCalls = sendCalls.filter((call) => call instanceof ScanCommand);
		const batchCalls = sendCalls.filter((call) => call instanceof BatchGetCommand);
		const queryCalls = sendCalls.filter((call) => call instanceof QueryCommand);
		expect(scanCalls).toHaveLength(1);
		expect(batchCalls).toHaveLength(expectedBatchGets);
		expect(queryCalls).toHaveLength(0);
	});

	test("throws SCAN_PAGE_LIMIT when base scan exceeds scanMaxPages", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command, callIndex) => {
				if (command instanceof ScanCommand) {
					const tableName = command.input.TableName;
					if (tableName === "auth_session") {
						if (callIndex === 0) {
							return {
								Items: [{ id: "session_0", userId: "user_0" }],
								LastEvaluatedKey: { id: "session_0" },
							};
						}
						return {
							Items: [{ id: "session_1", userId: "user_1" }],
							LastEvaluatedKey: undefined,
						};
					}
				}
				return {};
			},
		});

		const captureAsyncError = async <T>(fn: () => Promise<T>): Promise<unknown> => {
			try {
				await fn();
				return null;
			} catch (caught) {
				return caught;
			}
		};

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
			indexNameResolver: () => undefined,
		});
		const options: BetterAuthOptions = {
			experimental: { joins: false },
		};
		const adapter = adapterFactory(options);

		const error = await captureAsyncError(async () =>
			adapter.findMany<{ user: { id: string } | null }>({
				model: "session",
				limit: 2,
				join: { user: true },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("SCAN_PAGE_LIMIT");
		}
	});

	test("continues scanning when scanPageLimitMode is unbounded", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async (command, callIndex) => {
				if (command instanceof ScanCommand) {
					const tableName = command.input.TableName;
					if (tableName === "auth_session") {
						if (callIndex === 0) {
							return {
								Items: [{ id: "session_0", userId: "user_0" }],
								LastEvaluatedKey: { id: "session_0" },
							};
						}
						return {
							Items: [{ id: "session_1", userId: "user_1" }],
							LastEvaluatedKey: undefined,
						};
					}
				}

				if (command instanceof BatchGetCommand) {
					const request = command.input.RequestItems?.["auth_user"];
					const keys = request?.Keys ?? [];
					const items = keys.map((key) => ({
						id: key.id,
					}));
					return { Responses: { auth_user: items } };
				}

				return {};
			},
		});

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
			scanPageLimitMode: "unbounded",
			indexNameResolver: () => undefined,
		});
		const options: BetterAuthOptions = {
			experimental: { joins: false },
		};
		const adapter = adapterFactory(options);

		const result = await adapter.findMany<{ user: { id: string } | null }>({
			model: "session",
			limit: 2,
			join: { user: true },
		});

		expect(result).toHaveLength(2);
	});
});
