/**
 * @file DynamoDB query helper types (Better Auth independent).
 */
export type DynamoDBWhereOperator =
	| "eq"
	| "ne"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "in"
	| "not_in"
	| "contains"
	| "starts_with"
	| "ends_with";

export type DynamoDBWhereConnector = "AND" | "OR";

export type DynamoDBWhere = {
	field: string;
	operator?: DynamoDBWhereOperator | undefined;
	value: unknown;
	connector?: DynamoDBWhereConnector | undefined;
};
