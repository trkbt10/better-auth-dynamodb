/**
 * @file DynamoDB table schema definitions for Better Auth adapter.
 */
import type { IndexMapping, IndexResolverBundle, TableSchema } from "./dynamodb/types";

export const createIndexResolversFromSchemas = (
	schemas: TableSchema[],
): IndexResolverBundle => {
	if (schemas.length === 0) {
		throw new Error("index resolver creation requires table schemas.");
	}
	const partitionIndexMap = new Map<string, IndexMapping>();
	const indexNameMap = new Map<string, IndexMapping>();
	for (const schema of schemas) {
		for (const mapping of schema.indexMappings) {
			const partitionKey = `${schema.tableName}:${mapping.partitionKey}`;
			if (partitionIndexMap.has(partitionKey)) {
				throw new Error(
					`Duplicate partition key mapping for ${schema.tableName}.${mapping.partitionKey}.`,
				);
			}
			partitionIndexMap.set(partitionKey, mapping);

			const indexKey = `${schema.tableName}:${mapping.indexName}`;
			if (indexNameMap.has(indexKey)) {
				throw new Error(
					`Duplicate index name mapping for ${schema.tableName}.${mapping.indexName}.`,
				);
			}
			indexNameMap.set(indexKey, mapping);
		}
	}

	return {
		indexNameResolver: ({ model, field }) =>
			partitionIndexMap.get(`${model}:${field}`)?.indexName,
		indexKeySchemaResolver: ({ model, indexName }) => {
			const mapping = indexNameMap.get(`${model}:${indexName}`);
			if (!mapping) {
				return undefined;
			}
			return {
				partitionKey: mapping.partitionKey,
				sortKey: mapping.sortKey,
			};
		},
	};
};

export const multiTableSchemas: TableSchema[] = [
	{
		tableName: "user",
		tableDefinition: {
			attributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
			keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
			billingMode: "PAY_PER_REQUEST",
		},
		indexMappings: [],
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
