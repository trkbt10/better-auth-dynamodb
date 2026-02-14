/**
 * @file Core DynamoDB table schemas provided by this adapter.
 *
 * These are hand-crafted table definitions for Better Auth's core tables
 * (user, session, account, verification) with DynamoDB-optimized GSI configurations.
 *
 * Use these schemas when:
 * - You want explicit control over table structure
 * - You're not using Better Auth plugins that require additional tables
 * - You prefer hand-crafted definitions over auto-generation
 *
 * For plugin support, use `generateTableSchemas()` from `./from-better-auth.ts` instead.
 */
import type { TableSchema } from "../dynamodb/types";

/**
 * Core table schemas for Better Auth with DynamoDB-optimized GSIs.
 *
 * Includes:
 * - user: email, username GSIs
 * - session: userId+createdAt, token+createdAt composite GSIs
 * - account: accountId, userId, providerId+accountId GSIs
 * - verification: identifier+createdAt composite GSI
 */
export const coreTableSchemas: TableSchema[] = [
	{
		tableName: "user",
		tableDefinition: {
			attributeDefinitions: [
				{ AttributeName: "id", AttributeType: "S" },
				{ AttributeName: "email", AttributeType: "S" },
				{ AttributeName: "username", AttributeType: "S" },
			],
			keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
			billingMode: "PAY_PER_REQUEST",
			globalSecondaryIndexes: [
				{
					IndexName: "user_email_idx",
					KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
					Projection: { ProjectionType: "ALL" },
				},
				{
					IndexName: "user_username_idx",
					KeySchema: [{ AttributeName: "username", KeyType: "HASH" }],
					Projection: { ProjectionType: "ALL" },
				},
			],
		},
		indexMappings: [
			{ indexName: "user_email_idx", partitionKey: "email" },
			{ indexName: "user_username_idx", partitionKey: "username" },
		],
	},
	{
		tableName: "session",
		tableDefinition: {
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
		indexMappings: [
			{
				indexName: "session_userId_idx",
				partitionKey: "userId",
				sortKey: "createdAt",
			},
			{
				indexName: "session_token_idx",
				partitionKey: "token",
				sortKey: "createdAt",
			},
		],
	},
	{
		tableName: "account",
		tableDefinition: {
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
					IndexName: "account_accountId_idx",
					KeySchema: [{ AttributeName: "accountId", KeyType: "HASH" }],
					Projection: { ProjectionType: "ALL" },
				},
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
		indexMappings: [
			{ indexName: "account_accountId_idx", partitionKey: "accountId" },
			{ indexName: "account_userId_idx", partitionKey: "userId" },
			{
				indexName: "account_providerId_accountId_idx",
				partitionKey: "providerId",
				sortKey: "accountId",
			},
		],
	},
	{
		tableName: "verification",
		tableDefinition: {
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
		indexMappings: [
			{
				indexName: "verification_identifier_idx",
				partitionKey: "identifier",
				sortKey: "createdAt",
			},
		],
	},
];

/**
 * @deprecated Use `coreTableSchemas` instead. Will be removed in a future version.
 */
export const multiTableSchemas = coreTableSchemas;
