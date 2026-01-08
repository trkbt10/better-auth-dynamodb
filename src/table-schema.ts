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
			{ AttributeName: "token", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "session_userId_idx",
				KeySchema: [
					{ AttributeName: "userId", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "session_token_idx",
				KeySchema: [
					{ AttributeName: "token", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	{
		tableName: "account",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "userId", AttributeType: "S" },
			{ AttributeName: "providerId", AttributeType: "S" },
			{ AttributeName: "accountId", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "account_userId_idx",
				KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "account_providerId_accountId_idx",
				KeySchema: [
					{ AttributeName: "providerId", KeyType: "HASH" },
					{ AttributeName: "accountId", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	{
		tableName: "verification",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "identifier", AttributeType: "S" },
			{ AttributeName: "createdAt", AttributeType: "S" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		billingMode: "PAY_PER_REQUEST",
		globalSecondaryIndexes: [
			{
				IndexName: "verification_identifier_idx",
				KeySchema: [
					{ AttributeName: "identifier", KeyType: "HASH" },
					{ AttributeName: "createdAt", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
];
