/**
 * @file DynamoDB adapter shared types.
 */
import type { AttributeDefinition, BillingMode, GlobalSecondaryIndex, KeySchemaElement } from "@aws-sdk/client-dynamodb";
export type TableDefinition = {
    attributeDefinitions: AttributeDefinition[];
    keySchema: KeySchemaElement[];
    billingMode: BillingMode | undefined;
    globalSecondaryIndexes?: GlobalSecondaryIndex[] | undefined;
};
export type IndexMapping = {
    indexName: string;
    partitionKey: string;
    sortKey?: string | undefined;
};
export type TableSchema = {
    tableName: string;
    tableDefinition: TableDefinition;
    indexMappings: IndexMapping[];
};
export type DynamoDBIndexKeySchema = {
    partitionKey: string;
    sortKey?: string | undefined;
};
export type IndexResolverBundle = {
    indexNameResolver: (props: {
        model: string;
        field: string;
    }) => string | undefined;
    indexKeySchemaResolver: (props: {
        model: string;
        indexName: string;
    }) => DynamoDBIndexKeySchema | undefined;
};
export type DynamoDBWhereOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "starts_with" | "ends_with";
export type DynamoDBWhereConnector = "AND" | "OR";
export type DynamoDBWhere = {
    field: string;
    operator?: DynamoDBWhereOperator | undefined;
    value: unknown;
    connector?: DynamoDBWhereConnector | undefined;
};
//# sourceMappingURL=types.d.ts.map