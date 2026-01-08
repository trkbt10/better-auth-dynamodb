/**
 * @file DynamoDB table schema definitions for Better Auth adapter.
 */
import type {
  AttributeDefinition,
  BillingMode,
  GlobalSecondaryIndex,
  KeySchemaElement,
} from "@aws-sdk/client-dynamodb";

export type TableSchema = {
  tableName: string;
  attributeDefinitions: AttributeDefinition[];
  keySchema: KeySchemaElement[];
  billingMode: BillingMode | undefined;
  globalSecondaryIndexes?: GlobalSecondaryIndex[] | undefined;
};

export const multiTableSchemas: TableSchema[] = [
	{
		tableName: "user",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
	},
	{
		tableName: "session",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "userId", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "session_userId_idx",
				KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	{
		tableName: "account",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "userId", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "account_userId_idx",
				KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	{
		tableName: "verification",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "identifier", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "verification_identifier_idx",
				KeySchema: [{ AttributeName: "identifier", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
];
