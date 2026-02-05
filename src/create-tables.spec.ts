/**
 * @file Tests for createTables using multi-table schemas.
 */
import {
	CreateTableCommand,
	DescribeTableCommand,
	DynamoDBClient,
	ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { applyTableSchemas } from "./apply-table-schemas";
import { multiTableSchemas } from "./table-schema";

describe("applyTableSchemas", () => {
	test("creates tables with expected GSI definitions", async () => {
		const client = new DynamoDBClient({
			region: "us-east-1",
			credentials: {
				accessKeyId: "test",
				secretAccessKey: "test",
			},
		});
		const sendCalls: unknown[] = [];
		client.send = async (command) => {
			sendCalls.push(command);
			if (command instanceof ListTablesCommand) {
				return { TableNames: [] };
			}
			if (command instanceof DescribeTableCommand) {
				return { Table: { TableStatus: "ACTIVE" } };
			}
			return {};
		};

		const tables = multiTableSchemas.map((schema) => ({
			...schema,
			tableName: `test_${schema.tableName}`,
		}));

		await applyTableSchemas({
			client,
			tables,
			wait: { maxWaitTime: 2, minDelay: 1 },
		});

		const createCommands = sendCalls.filter(
			(command): command is CreateTableCommand =>
				command instanceof CreateTableCommand,
		);
		const sessionCommand = createCommands.find(
			(command) => command.input.TableName === "test_session",
		);

		expect(createCommands.length).toBe(tables.length);
		expect(sessionCommand?.input.GlobalSecondaryIndexes).toEqual([
			{
				IndexName: "session_userId_idx",
				KeySchema: [
					{ AttributeName: "userId", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "session_token_idx",
				KeySchema: [
					{ AttributeName: "token", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		]);
	});

	test("keeps schema and indexNameResolver patterns aligned", () => {
		const expectedIndexes: Record<string, string[]> = {
			user: ["user_email_idx", "user_username_idx"],
			session: ["session_userId_idx", "session_token_idx"],
			account: [
				"account_accountId_idx",
				"account_userId_idx",
				"account_providerId_accountId_idx",
			],
			verification: ["verification_identifier_idx"],
		};

		for (const schema of multiTableSchemas) {
			const indexes = schema.tableDefinition.globalSecondaryIndexes?.map(
				(index) => index.IndexName,
			) ?? [];
			expect(indexes).toEqual(expectedIndexes[schema.tableName] ?? []);
		}
	});
});
