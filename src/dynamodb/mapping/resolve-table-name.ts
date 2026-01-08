/**
 * @file Table name resolution for DynamoDB adapter.
 */
import { DynamoDBAdapterError } from "../errors/errors";
import type { DynamoDBAdapterConfig } from "../../adapter";

export type DefaultModelNameResolver = (model: string) => string;

export const resolveTableName = (props: {
	model: string;
	getDefaultModelName: DefaultModelNameResolver;
	config: DynamoDBAdapterConfig;
}): string => {
	const { model, getDefaultModelName, config } = props;
	const defaultModelName = getDefaultModelName(model);

	if (config.tableNameResolver) {
		return config.tableNameResolver(defaultModelName);
	}

	if (config.tableNamePrefix !== undefined) {
		return `${config.tableNamePrefix}${defaultModelName}`;
	}

	throw new DynamoDBAdapterError(
		"MISSING_TABLE_RESOLVER",
		"DynamoDB adapter requires tableNameResolver or tableNamePrefix.",
	);
};
