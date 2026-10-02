import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
export type DefaultModelNameResolver = (model: string) => string;
export type TableNameConfig = Pick<ResolvedDynamoDBAdapterConfig, "tableNameResolver" | "tableNamePrefix" | "resolveSchemaModelName">;
/**
 * Resolve the DynamoDB table of a model.
 *
 * - `tableNameResolver` receives the default model name (`user`, `session`, ...).
 * - `tableNamePrefix` is put in front of the model name the Better Auth schema
 *   declares, i.e. a custom `modelName` when one is configured. That is the
 *   name `generateTableSchemas` gives the table.
 */
export declare const resolveTableName: <TConfig extends TableNameConfig>(props: {
    model: string;
    getDefaultModelName: DefaultModelNameResolver;
    config: TConfig;
}) => string;
//# sourceMappingURL=resolve-table-name.d.ts.map