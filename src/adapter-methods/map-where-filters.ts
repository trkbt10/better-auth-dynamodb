/**
 * @file Map Better Auth where filters to DynamoDB where filters.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type {
	DynamoDBWhere,
	DynamoDBWhereConnector,
	DynamoDBWhereOperator,
} from "../dynamodb/types";

const resolveWhereOperator = (
	operator: Where["operator"],
): DynamoDBWhereOperator => {
	if (operator) {
		return operator as DynamoDBWhereOperator;
	}
	return "eq";
};

const resolveWhereConnector = (
	connector: Where["connector"],
): DynamoDBWhereConnector => {
	if (connector) {
		return connector;
	}
	return "AND";
};

export const mapWhereFilters = (
	where: Where[] | undefined,
): DynamoDBWhere[] | undefined => {
	if (!where || where.length === 0) {
		return undefined;
	}
	return where.map((entry) => ({
		field: entry.field,
		operator: resolveWhereOperator(entry.operator),
		value: entry.value,
		connector: resolveWhereConnector(entry.connector),
	}));
};
