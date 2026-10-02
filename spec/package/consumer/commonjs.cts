/**
 * @file Compile a consumer using Node CommonJS module resolution.
 */
import * as api from "@trkbt10/better-auth-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const schemas: api.TableSchema[] = api.generateTableSchemas({});
const config: api.DynamoDBAdapterConfig = {
  documentClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })),
  ...api.createIndexResolversFromSchemas(schemas),
};
api.dynamodbAdapter(config)({});
