/**
 * @file DynamoDB table creation helpers for Better Auth adapter.
 */
import {
  CreateTableCommand,
  ListTablesCommand,
  waitUntilTableExists,
  type DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import type { TableSchema } from "./table-schema";
import { DynamoDBAdapterError } from "./dynamodb/errors/errors";
type WaiterConfiguration = Omit<
  Parameters<typeof waitUntilTableExists>[0],
  "client"
>;
type CreateTablesOptions = {
  client: DynamoDBClient;
  tables: TableSchema[];
  wait?: WaiterConfiguration;
};

const listTableNames = async (client: DynamoDBClient): Promise<string[]> => {
  const tableNames: string[] = [];
  const state = { lastEvaluatedTableName: undefined as string | undefined };

  for (;;) {
    const response = await client.send(
      new ListTablesCommand({
        ExclusiveStartTableName: state.lastEvaluatedTableName,
      }),
    );
    tableNames.push(...(response.TableNames ?? []));
    state.lastEvaluatedTableName = response.LastEvaluatedTableName;
    if (!state.lastEvaluatedTableName) {
      break;
    }
  }

  return tableNames;
};

export const createTables = async (options: CreateTablesOptions): Promise<string[]> => {
  if (!options.client) {
    throw new DynamoDBAdapterError("MISSING_CLIENT", "DynamoDB createTables requires a DynamoDBClient instance.");
  }

  const existingTables = await listTableNames(options.client);
  const waitConfig = options.wait ?? { maxWaitTime: 60, minDelay: 2 };
  const createdTables: string[] = [];

  for (const table of options.tables) {
    if (existingTables.includes(table.tableName)) {
      continue;
    }
    await options.client.send(
      new CreateTableCommand({
        TableName: table.tableName,
        AttributeDefinitions: table.attributeDefinitions,
        KeySchema: table.keySchema,
        BillingMode: table.billingMode,
        GlobalSecondaryIndexes: table.globalSecondaryIndexes,
      }),
    );
    await waitUntilTableExists({ client: options.client, ...waitConfig }, { TableName: table.tableName });
    createdTables.push(table.tableName);
  }

  return createdTables;
};
