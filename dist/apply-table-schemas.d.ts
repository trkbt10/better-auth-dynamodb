/**
 * @file DynamoDB table schema application helpers for Better Auth adapter.
 */
import { waitUntilTableExists, type DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { TableSchema } from "./dynamodb/types";
type WaiterConfiguration = Omit<Parameters<typeof waitUntilTableExists>[0], "client">;
export type ApplyTableSchemasOptions = {
    client: DynamoDBClient;
    tables: TableSchema[];
    wait?: WaiterConfiguration | undefined;
};
export type ApplyTableSchemasResult = {
    createdTables: string[];
    updatedTables: string[];
};
export declare const applyTableSchemas: (options: ApplyTableSchemasOptions) => Promise<ApplyTableSchemasResult>;
export {};
//# sourceMappingURL=apply-table-schemas.d.ts.map