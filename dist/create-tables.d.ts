/**
 * @file DynamoDB table creation helpers for Better Auth adapter.
 */
import { waitUntilTableExists, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { TableSchema } from "./dynamodb/types";
type WaiterConfiguration = Omit<Parameters<typeof waitUntilTableExists>[0], "client">;
type CreateTablesOptions = {
    client: DynamoDBClient;
    tables: TableSchema[];
    wait?: WaiterConfiguration;
};
export declare const createTables: (options: CreateTablesOptions) => Promise<string[]>;
export {};
//# sourceMappingURL=create-tables.d.ts.map