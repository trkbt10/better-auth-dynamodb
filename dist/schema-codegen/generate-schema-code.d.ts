/**
 * @file Generate TypeScript code for DynamoDB table creation.
 *
 * This module generates executable TypeScript code that creates DynamoDB tables
 * based on Better Auth schema definitions. The generated code uses the
 * `applyTableSchemas` function from this package.
 */
import type { BetterAuthDBSchema } from "@better-auth/core/db";
import type { GenerateTableSchemasOptions } from "../table-schemas/types";
export type GenerateSchemaCodeOptions = GenerateTableSchemasOptions & {
    /**
     * Output file path (used in generated comments).
     */
    file?: string;
    /**
     * Table name prefix to apply to all table names.
     * If provided, the generated code will prefix all table names.
     */
    tableNamePrefix?: string;
};
export declare const generateSchemaCode: (props: {
    tables: BetterAuthDBSchema;
    file?: string;
    tableNamePrefix?: string;
    schemaOptions?: GenerateTableSchemasOptions;
}) => string;
//# sourceMappingURL=generate-schema-code.d.ts.map