/**
 * @file Exercise public exports through installed ESM and CommonJS entry points.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as esm from "@trkbt10/better-auth-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const require = createRequire(import.meta.url);
const cjs = require("@trkbt10/better-auth-dynamodb");
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
assert.equal(require("@trkbt10/better-auth-dynamodb/package.json").name, "@trkbt10/better-auth-dynamodb");

for (const api of [esm, cjs]) {
  const schemas = api.generateTableSchemas({});
  assert.deepEqual(schemas.map((schema) => schema.tableName).sort(), ["account", "session", "user", "verification"]);
  assert.equal(typeof api.applyTableSchemas, "function");
  assert.equal(typeof api.createTables, "function");
  const client = new DynamoDBClient({ region: "us-east-1" });
  const documentClient = DynamoDBDocumentClient.from(client);
  const resolvers = api.createIndexResolversFromSchemas(schemas);
  const adapter = api.dynamodbAdapter({ documentClient, ...resolvers })({});
  assert.equal(typeof adapter.create, "function");
  assert.equal(typeof adapter.consumeOne, "function");
  assert.equal(typeof adapter.incrementOne, "function");
  assert.throws(() => api.dynamodbAdapter({ documentClient }), api.DynamoDBAdapterError);
  const generated = await adapter.createSchema({ tables: {} });
  assert.ok(generated.code.includes('from "@trkbt10/better-auth-dynamodb"'));
  client.destroy();
}
