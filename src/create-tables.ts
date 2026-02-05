/**
 * @file DynamoDB table creation helpers for Better Auth adapter.
 */
import type { ApplyTableSchemasOptions } from "./apply-table-schemas";
import { applyTableSchemas } from "./apply-table-schemas";

/**
 * @deprecated Use `applyTableSchemas` instead. This helper now applies GSI schema changes too.
 */
export const createTables = async (
	options: ApplyTableSchemasOptions,
): Promise<string[]> => {
	const result = await applyTableSchemas(options);
	return result.createdTables;
};
