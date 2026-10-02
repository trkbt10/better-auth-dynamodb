/**
 * @file Table name resolution for DynamoDB adapter.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";

export type DefaultModelNameResolver = (model: string) => string;

export type TableNameConfig = Pick<
	ResolvedDynamoDBAdapterConfig,
	"tableNameResolver" | "tableNamePrefix" | "resolveSchemaModelName"
>;

/**
 * Resolve the DynamoDB table of a model.
 *
 * - `tableNameResolver` receives the default model name (`user`, `session`, ...).
 * - `tableNamePrefix` is put in front of the model name the Better Auth schema
 *   declares, i.e. a custom `modelName` when one is configured. That is the
 *   name `generateTableSchemas` gives the table.
 */
export const resolveTableName = <TConfig extends TableNameConfig>(props: {
	model: string;
	getDefaultModelName: DefaultModelNameResolver;
	config: TConfig;
}): string => {
	const { model, getDefaultModelName, config } = props;
	const defaultModelName = getDefaultModelName(model);

	if (config.tableNameResolver) {
		return config.tableNameResolver(defaultModelName);
	}

	if (config.tableNamePrefix !== undefined) {
		const modelName =
			config.resolveSchemaModelName?.(defaultModelName) ?? defaultModelName;
		return `${config.tableNamePrefix}${modelName}`;
	}

	throw new DynamoDBAdapterError(
		"MISSING_TABLE_RESOLVER",
		"DynamoDB adapter requires tableNameResolver or tableNamePrefix.",
	);
};
