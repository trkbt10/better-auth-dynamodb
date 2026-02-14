/**
 * @file Tests for applyTableSchemas.
 */
import {
	CreateTableCommand,
	DescribeTableCommand,
	DynamoDBClient,
	ListTablesCommand,
	UpdateTableCommand,
	type AttributeDefinition,
	type GlobalSecondaryIndex,
} from "@aws-sdk/client-dynamodb";
import { applyTableSchemas } from "./apply-table-schemas";
import type { TableSchema } from "./dynamodb/types";

type TableState = {
	attributeDefinitions: AttributeDefinition[];
	globalSecondaryIndexes: GlobalSecondaryIndex[];
};

const toDescribeIndex = (index: GlobalSecondaryIndex) => ({
	IndexName: index.IndexName,
	KeySchema: index.KeySchema,
	Projection: index.Projection,
	ProvisionedThroughput: index.ProvisionedThroughput,
	IndexStatus: "ACTIVE" as const,
});

const createClientStub = (initial: Record<string, TableState>) => {
	const sendCalls: unknown[] = [];
	const tables = new Map<string, TableState>(
		Object.entries(initial).map(([name, state]) => [name, state]),
	);
	const client = new DynamoDBClient({
		region: "us-east-1",
		credentials: {
			accessKeyId: "test",
			secretAccessKey: "test",
		},
	});

	client.send = async (command) => {
		sendCalls.push(command);

		if (command instanceof ListTablesCommand) {
			return { TableNames: Array.from(tables.keys()), LastEvaluatedTableName: undefined };
		}

		if (command instanceof CreateTableCommand) {
			const tableName = command.input.TableName ?? "";
			tables.set(tableName, {
				attributeDefinitions: command.input.AttributeDefinitions ?? [],
				globalSecondaryIndexes: command.input.GlobalSecondaryIndexes ?? [],
			});
			return {};
		}

		if (command instanceof DescribeTableCommand) {
			const tableName = command.input.TableName ?? "";
			const table = tables.get(tableName);
			if (!table) {
				return {};
			}
			return {
				Table: {
					TableName: tableName,
					TableStatus: "ACTIVE" as const,
					AttributeDefinitions: table.attributeDefinitions,
					GlobalSecondaryIndexes: table.globalSecondaryIndexes.map(toDescribeIndex),
				},
			};
		}

		if (command instanceof UpdateTableCommand) {
			const tableName = command.input.TableName ?? "";
			const table = tables.get(tableName);
			if (!table) {
				return {};
			}
			const updates = command.input.GlobalSecondaryIndexUpdates ?? [];
			const update = updates[0];
			if (update?.Delete?.IndexName) {
				table.globalSecondaryIndexes = table.globalSecondaryIndexes.filter(
					(entry) => entry.IndexName !== update.Delete?.IndexName,
				);
			}
			if (update?.Create?.IndexName) {
				const created: GlobalSecondaryIndex = {
					IndexName: update.Create.IndexName,
					KeySchema: update.Create.KeySchema,
					Projection: update.Create.Projection,
					ProvisionedThroughput: update.Create.ProvisionedThroughput,
				};
				table.globalSecondaryIndexes = [...table.globalSecondaryIndexes, created];
				const attrDefs = command.input.AttributeDefinitions ?? [];
				for (const def of attrDefs) {
					const existing = table.attributeDefinitions.find(
						(entry) => entry.AttributeName === def.AttributeName,
					);
					if (!existing) {
						table.attributeDefinitions = [...table.attributeDefinitions, def];
					}
				}
			}
			tables.set(tableName, table);
			return {};
		}

		return {};
	};

	return { client, sendCalls, tables };
};

describe("applyTableSchemas", () => {
	test("creates missing tables and returns createdTables", async () => {
		const { client, sendCalls } = createClientStub({});
		const schema: TableSchema = {
			tableName: "test_users",
			tableDefinition: {
				attributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
				keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
				billingMode: "PAY_PER_REQUEST",
				globalSecondaryIndexes: [],
			},
			indexMappings: [],
		};

		const result = await applyTableSchemas({
			client,
			tables: [schema],
			wait: { maxWaitTime: 2, minDelay: 1 },
		});

		expect(result.createdTables).toEqual(["test_users"]);
		expect(sendCalls.some((call) => call instanceof CreateTableCommand)).toBe(true);
	});

	test("adds missing GSIs on existing tables", async () => {
		const { client, sendCalls } = createClientStub({
			test_account: {
				attributeDefinitions: [
					{ AttributeName: "id", AttributeType: "S" },
					{ AttributeName: "accountId", AttributeType: "S" },
				],
				globalSecondaryIndexes: [],
			},
		});

		const schema: TableSchema = {
			tableName: "test_account",
			tableDefinition: {
				attributeDefinitions: [
					{ AttributeName: "id", AttributeType: "S" },
					{ AttributeName: "accountId", AttributeType: "S" },
				],
				keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
				billingMode: "PAY_PER_REQUEST",
				globalSecondaryIndexes: [
					{
						IndexName: "account_accountId_idx",
						KeySchema: [{ AttributeName: "accountId", KeyType: "HASH" }],
						Projection: { ProjectionType: "ALL" },
					},
				],
			},
			indexMappings: [{ indexName: "account_accountId_idx", partitionKey: "accountId" }],
		};

		const result = await applyTableSchemas({
			client,
			tables: [schema],
			wait: { maxWaitTime: 2, minDelay: 1 },
		});

		expect(result.createdTables).toEqual([]);
		expect(result.updatedTables).toEqual(["test_account"]);
		const updateCalls = sendCalls.filter((call) => call instanceof UpdateTableCommand);
		expect(updateCalls).toHaveLength(1);
		const update = updateCalls[0] as UpdateTableCommand;
		expect(update.input.GlobalSecondaryIndexUpdates?.[0]?.Create?.IndexName).toBe(
			"account_accountId_idx",
		);
	});

	test("deletes and recreates GSIs when definitions differ", async () => {
		const { client, sendCalls } = createClientStub({
			test_account: {
				attributeDefinitions: [
					{ AttributeName: "id", AttributeType: "S" },
					{ AttributeName: "providerId", AttributeType: "S" },
					{ AttributeName: "accountId", AttributeType: "S" },
				],
				globalSecondaryIndexes: [
					{
						IndexName: "account_providerId_accountId_idx",
						KeySchema: [{ AttributeName: "providerId", KeyType: "HASH" }],
						Projection: { ProjectionType: "ALL" },
					},
				],
			},
		});

		const schema: TableSchema = {
			tableName: "test_account",
			tableDefinition: {
				attributeDefinitions: [
					{ AttributeName: "id", AttributeType: "S" },
					{ AttributeName: "providerId", AttributeType: "S" },
					{ AttributeName: "accountId", AttributeType: "S" },
				],
				keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
				billingMode: "PAY_PER_REQUEST",
				globalSecondaryIndexes: [
					{
						IndexName: "account_providerId_accountId_idx",
						KeySchema: [
							{ AttributeName: "providerId", KeyType: "HASH" },
							{ AttributeName: "accountId", KeyType: "RANGE" },
						],
						Projection: { ProjectionType: "ALL" },
					},
				],
			},
			indexMappings: [
				{
					indexName: "account_providerId_accountId_idx",
					partitionKey: "providerId",
					sortKey: "accountId",
				},
			],
		};

		const result = await applyTableSchemas({
			client,
			tables: [schema],
			wait: { maxWaitTime: 2, minDelay: 1 },
		});

		expect(result.updatedTables).toEqual(["test_account"]);
		const updateCalls = sendCalls.filter((call) => call instanceof UpdateTableCommand);
		expect(updateCalls).toHaveLength(2);
		const deleteCall = updateCalls[0] as UpdateTableCommand;
		const createCall = updateCalls[1] as UpdateTableCommand;
		expect(deleteCall.input.GlobalSecondaryIndexUpdates?.[0]?.Delete?.IndexName).toBe(
			"account_providerId_accountId_idx",
		);
		expect(createCall.input.GlobalSecondaryIndexUpdates?.[0]?.Create?.IndexName).toBe(
			"account_providerId_accountId_idx",
		);
	});
});
