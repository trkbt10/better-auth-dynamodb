import type { BetterAuthOptions } from "@better-auth/core";
import type { BetterAuthDBSchema } from "@better-auth/core/db";
import type { TableSchema } from "../dynamodb/types";
import type { GenerateTableSchemasOptions } from "./types";
/**
 * Generate DynamoDB TableSchema array from Better Auth options.
 *
 * This function uses Better Auth's `getAuthTables()` internally, which is the same
 * method used by `npx @better-auth/cli migrate`. This ensures schema compatibility
 * with Better Auth's expectations.
 *
 * @param options - Better Auth configuration options (same as betterAuth())
 * @param schemaOptions - Optional schema generation options
 * @returns Array of TableSchema for use with applyTableSchemas and createIndexResolversFromSchemas
 */
export declare const generateTableSchemas: (options: BetterAuthOptions, schemaOptions?: GenerateTableSchemasOptions) => TableSchema[];
/**
 * Convert Better Auth database schema to DynamoDB TableSchema format.
 *
 * This is a lower-level function for when you already have a BetterAuthDBSchema.
 * Most users should use `generateTableSchemas()` instead.
 *
 * @param tables - Better Auth database schema
 * @param schemaOptions - Optional schema generation options
 * @returns Array of TableSchema
 */
export declare const convertToTableSchemas: (tables: BetterAuthDBSchema, schemaOptions?: GenerateTableSchemasOptions) => TableSchema[];
//# sourceMappingURL=from-better-auth.d.ts.map