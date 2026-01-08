# Better Auth DynamoDB Adapter

A DynamoDB adapter for [Better Auth](https://www.better-auth.com/) that enables authentication data storage using AWS DynamoDB.

## Features

- Full DynamoDB support for Better Auth authentication
- Multi-table schema with optimized GSI configurations
- Transaction support for atomic operations
- Configurable table naming (prefix or custom resolver)
- Built-in table creation utilities
- TypeScript-first with full type safety

## Requirements

- Node.js 18+
- AWS DynamoDB (local or cloud)
- AWS SDK v3

## Installation

```bash
# npm
npm install github:trkbt10/better-auth-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# yarn
yarn add github:trkbt10/better-auth-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# pnpm
pnpm add github:trkbt10/better-auth-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb

# bun
bun add github:trkbt10/better-auth-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

To install a specific version or branch:

```bash
# specific tag/release
npm install github:trkbt10/better-auth-dynamodb#v1.0.0

# specific branch
npm install github:trkbt10/better-auth-dynamodb#main
```

## Quick Start

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import {
  createIndexResolversFromSchemas,
  dynamodbAdapter,
  multiTableSchemas,
} from "better-auth-dynamodb";

// 1. Create DynamoDB client
const client = new DynamoDBClient({ region: "us-east-1" });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// 2. Create index resolvers from provided schemas
const { indexNameResolver, indexKeySchemaResolver } =
  createIndexResolversFromSchemas(multiTableSchemas);

// 3. Configure the adapter
const adapter = dynamodbAdapter({
  documentClient,
  tableNamePrefix: "better_auth_",
  scanMaxPages: 25,
  indexNameResolver,
  indexKeySchemaResolver,
  transaction: true,
});

// 4. Use with Better Auth
const auth = betterAuth({
  database: { adapter },
});
```

## Table Setup

Before using the adapter, create the required DynamoDB tables.

### Using the built-in helper

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createTables, multiTableSchemas } from "better-auth-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

// Apply table name prefix to schemas
const tables = multiTableSchemas.map((schema) => ({
  ...schema,
  tableName: `better_auth_${schema.tableName}`,
}));

await createTables({ client, tables });
```

This creates four tables with optimized GSI configurations:

| Table | Primary Key | Global Secondary Indexes |
|-------|-------------|-------------------------|
| `user` | `id` (HASH) | — |
| `session` | `id` (HASH) | `userId + createdAt`, `token + createdAt` |
| `account` | `id` (HASH) | `userId`, `providerId + accountId` |
| `verification` | `id` (HASH) | `identifier + createdAt` |

## Configuration Options

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `documentClient` | `DynamoDBDocumentClient` | AWS SDK DynamoDB Document Client instance |
| `indexNameResolver` | `(props: { model, field }) => string \| undefined` | Resolves field names to GSI names for query optimization |

### Table Naming

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tableNamePrefix` | `string` | — | Prefix for all table names (e.g., `"auth_"` → `auth_user`) |
| `tableNameResolver` | `(modelName: string) => string` | — | Custom function for table name resolution |
| `usePlural` | `boolean` | `false` | Use pluralized model names (e.g., `users` instead of `user`) |

### Query & Index Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `indexKeySchemaResolver` | `(props: { model, indexName }) => { partitionKey, sortKey? } \| undefined` | — | Resolves GSI key schemas for composite key queries and server-side sorting |
| `scanMaxPages` | `number` | — | Maximum scan pages before aborting (required when scans may occur) |

### ID Generation

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `customIdGenerator` | `(props: { model }) => string` | `crypto.randomUUID()` | Custom ID generator function (e.g., ULID, nanoid, cuid) |
| `disableIdGeneration` | `boolean` | `false` | Disable automatic ID generation |

### Data Transformation

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mapKeysTransformInput` | `Record<string, string>` | — | Map field names before saving (e.g., `{ id: "pk" }`) |
| `mapKeysTransformOutput` | `Record<string, string>` | — | Map field names when reading (e.g., `{ pk: "id" }`) |
| `customTransformInput` | `(props) => any` | — | Custom transform function for input data |
| `customTransformOutput` | `(props) => any` | — | Custom transform function for output data |

### Other Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transaction` | `boolean` | `false` | Enable adapter-layer transactions |
| `debugLogs` | `DBAdapterDebugLogOption` | — | Better Auth debug logging options |

## Behavior Notes

### Date Handling

The adapter has `supportsDates` disabled. Date fields are stored as ISO 8601 strings and must be serialized before adapter use.

### ID Generation

By default, the adapter uses `crypto.randomUUID()` for ID generation. You can customize this with `customIdGenerator`:

```ts
import { ulid } from "ulid";

const adapter = dynamodbAdapter({
  documentClient,
  indexNameResolver,
  customIdGenerator: ({ model }) => ulid(),
});
```

`supportsNumericIds` is disabled. Do not enable Better Auth numeric ID generation (`useNumberId` or `generateId: "serial"`).

### Scan Protection

Table scans are guarded by `scanMaxPages`. If a query cannot use an index and requires a scan, the adapter will throw an error if `scanMaxPages` is not configured.

## Examples

### Custom table names

```ts
const adapter = dynamodbAdapter({
  documentClient,
  tableNameResolver: (modelName) => `tenant_${tenantId}_${modelName}`,
  indexNameResolver,
  indexKeySchemaResolver,
});
```

### Using table name prefix

```ts
const adapter = dynamodbAdapter({
  documentClient,
  tableNamePrefix: "auth_",
  indexNameResolver,
  indexKeySchemaResolver,
});
```

This maps core models to: `auth_user`, `auth_session`, `auth_account`, `auth_verification`.

### Custom index resolvers

For custom table schemas, create your own index resolvers:

```ts
const indexNameResolver = ({ model, field }) => {
  const indexes = {
    session: { userId: "session_userId_idx", token: "session_token_idx" },
    account: { userId: "account_userId_idx", providerId: "account_providerId_accountId_idx" },
  };
  return indexes[model]?.[field];
};

const adapter = dynamodbAdapter({
  documentClient,
  indexNameResolver,
  scanMaxPages: 25,
});
```

## Local Development

Tests use DynamoDB Local by default.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DYNAMODB_ENDPOINT` | `http://localhost:8000` | DynamoDB endpoint URL |
| `AWS_ACCESS_KEY_ID` | `fakeAccessKeyId` | AWS access key (any value for local) |
| `AWS_SECRET_ACCESS_KEY` | `fakeSecretAccessKey` | AWS secret key (any value for local) |

### Running tests

```bash
# Start DynamoDB Local (via Docker)
docker run -p 8000:8000 amazon/dynamodb-local

# Run tests
bun run test
```

## License

This is free and unencumbered software released into the public domain. See [UNLICENSE](UNLICENSE) for details.
