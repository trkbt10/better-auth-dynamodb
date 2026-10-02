/**
 * @file Compile a consumer using Node ESM module resolution.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import {
  createIndexResolversFromSchemas,
  dynamodbAdapter,
  generateTableSchemas,
  type DynamoDBAdapterConfig,
  type TableSchema,
} from "@trkbt10/better-auth-dynamodb";

const schemas: TableSchema[] = generateTableSchemas({});
const config: DynamoDBAdapterConfig = {
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
  ...createIndexResolversFromSchemas(schemas),
};
betterAuth({ database: dynamodbAdapter(config) });
