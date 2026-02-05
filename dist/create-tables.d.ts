/**
 * @file DynamoDB table creation helpers for Better Auth adapter.
 */
import type { ApplyTableSchemasOptions } from "./apply-table-schemas";
/**
 * @deprecated Use `applyTableSchemas` instead. This helper now applies GSI schema changes too.
 */
export declare const createTables: (options: ApplyTableSchemasOptions) => Promise<string[]>;
//# sourceMappingURL=create-tables.d.ts.map