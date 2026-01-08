/**
 * @file Package entry point for DynamoDB adapter exports.
 */
export { dynamodbAdapter } from "./adapter";
export { DynamoDBAdapterError } from "./dynamodb/errors/errors";
export type {
	DynamoDBAdapterConfig,
	DynamoDBTableNameResolver,
} from "./adapter";
