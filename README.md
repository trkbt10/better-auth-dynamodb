<div align="center">

# 🔐 Better Auth DynamoDB Adapter

**A DynamoDB adapter for [Better Auth](https://www.better-auth.com/) that enables authentication data storage using AWS DynamoDB.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-Unlicense-purple?style=flat-square)](./UNLICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Better Auth](https://img.shields.io/badge/Better_Auth-1.0+-FF6B6B?style=flat-square)](https://www.better-auth.com/)
[![AWS DynamoDB](https://img.shields.io/badge/AWS-DynamoDB-FF9900?style=flat-square&logo=amazondynamodb&logoColor=white)](https://aws.amazon.com/dynamodb/)

</div>

## ✨ Features

- 🚀 **Full DynamoDB Support** — Native AWS SDK v3 integration
- 📊 **Optimized GSI Configurations** — Multi-table schema with smart indexing
- ⚡ **Transaction Support** — Atomic operations for data consistency
- 🎯 **Flexible Table Naming** — Prefix or custom resolver patterns
- 🛠️ **Built-in Table Creation** — Zero-config setup utilities
- 🔒 **TypeScript-First** — Complete type safety out of the box

## 📋 Requirements

| Requirement  | Version        |
| ------------ | -------------- |
| Node.js      | 18+            |
| AWS DynamoDB | Local or Cloud |
| AWS SDK      | v3             |

## 📦 Installation

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

<details>
<summary>📌 Install specific version or branch</summary>

```bash
# specific tag/release
npm install github:trkbt10/better-auth-dynamodb#v1.0.0

# specific branch
npm install github:trkbt10/better-auth-dynamodb#main
```

</details>

## 🚀 Quick Start

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import { createIndexResolversFromSchemas, dynamodbAdapter, multiTableSchemas } from "better-auth-dynamodb";

// 1. Create DynamoDB client
const client = new DynamoDBClient({ region: "us-east-1" });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// 2. Create index resolvers from provided schemas
const { indexNameResolver, indexKeySchemaResolver } = createIndexResolversFromSchemas(multiTableSchemas);

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

## 🗄️ Table Setup

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

### Using AWS CDK

<details>
<summary>📘 CDK Stack Example</summary>

```ts
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class BetterAuthTablesStack extends cdk.Stack {
  public readonly userTable: dynamodb.Table;
  public readonly sessionTable: dynamodb.Table;
  public readonly accountTable: dynamodb.Table;
  public readonly verificationTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const tablePrefix = "better_auth_";

    // User table
    this.userTable = new dynamodb.Table(this, "UserTable", {
      tableName: `${tablePrefix}user`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Session table
    this.sessionTable = new dynamodb.Table(this, "SessionTable", {
      tableName: `${tablePrefix}session`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.sessionTable.addGlobalSecondaryIndex({
      indexName: "session_userId_idx",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.sessionTable.addGlobalSecondaryIndex({
      indexName: "session_token_idx",
      partitionKey: { name: "token", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Account table
    this.accountTable = new dynamodb.Table(this, "AccountTable", {
      tableName: `${tablePrefix}account`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.accountTable.addGlobalSecondaryIndex({
      indexName: "account_userId_idx",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.accountTable.addGlobalSecondaryIndex({
      indexName: "account_providerId_accountId_idx",
      partitionKey: { name: "providerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Verification table
    this.verificationTable = new dynamodb.Table(this, "VerificationTable", {
      tableName: `${tablePrefix}verification`,
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.verificationTable.addGlobalSecondaryIndex({
      indexName: "verification_identifier_idx",
      partitionKey: { name: "identifier", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
```

</details>

### IAM Permissions

<details>
<summary>🔑 IAM Policy Example</summary>

```ts
import * as iam from "aws-cdk-lib/aws-iam";

// Minimal policy for Better Auth DynamoDB operations
const betterAuthDynamoDBPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "dynamodb:BatchGetItem",
    "dynamodb:BatchWriteItem",
  ],
  resources: [
    userTable.tableArn,
    sessionTable.tableArn,
    accountTable.tableArn,
    verificationTable.tableArn,
    `${sessionTable.tableArn}/index/*`,
    `${accountTable.tableArn}/index/*`,
    `${verificationTable.tableArn}/index/*`,
  ],
});

// If using transactions (transaction: true in adapter config)
const transactionPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ["dynamodb:TransactWriteItems"],
  resources: [userTable.tableArn, sessionTable.tableArn, accountTable.tableArn, verificationTable.tableArn],
});

// Attach to Lambda function
lambdaFunction.addToRolePolicy(betterAuthDynamoDBPolicy);
lambdaFunction.addToRolePolicy(transactionPolicy);
```

</details>

#### Required IAM Actions

| Action                        | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `dynamodb:GetItem`            | Fetch single items by primary key             |
| `dynamodb:PutItem`            | Create new items                              |
| `dynamodb:UpdateItem`         | Update existing items                         |
| `dynamodb:DeleteItem`         | Delete items                                  |
| `dynamodb:Query`              | Query tables and GSIs                         |
| `dynamodb:Scan`               | Scan tables (when index not available)        |
| `dynamodb:BatchGetItem`       | Batch read operations                         |
| `dynamodb:BatchWriteItem`     | Batch write operations                        |
| `dynamodb:TransactWriteItems` | Transactional writes (if `transaction: true`) |

### Table Schema Overview

| Table          | Primary Key | Global Secondary Indexes                  |
| -------------- | ----------- | ----------------------------------------- |
| `user`         | `id` (HASH) | —                                         |
| `session`      | `id` (HASH) | `userId + createdAt`, `token + createdAt` |
| `account`      | `id` (HASH) | `userId`, `providerId + accountId`        |
| `verification` | `id` (HASH) | `identifier + createdAt`                  |

## ⚙️ Configuration

### Required Options

| Option              | Type                                               | Description                                              |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `documentClient`    | `DynamoDBDocumentClient`                           | AWS SDK DynamoDB Document Client instance                |
| `indexNameResolver` | `(props: { model, field }) => string \| undefined` | Resolves field names to GSI names for query optimization |

### Table Naming

| Option              | Type                            | Default | Description                                                  |
| ------------------- | ------------------------------- | ------- | ------------------------------------------------------------ |
| `tableNamePrefix`   | `string`                        | —       | Prefix for all table names (e.g., `"auth_"` → `auth_user`)   |
| `tableNameResolver` | `(modelName: string) => string` | —       | Custom function for table name resolution                    |
| `usePlural`         | `boolean`                       | `false` | Use pluralized model names (e.g., `users` instead of `user`) |

### Query & Index Options

| Option                   | Type                                                 | Default | Description                                        |
| ------------------------ | ---------------------------------------------------- | ------- | -------------------------------------------------- |
| `indexKeySchemaResolver` | `(props) => { partitionKey, sortKey? } \| undefined` | —       | Resolves GSI key schemas for composite key queries |
| `scanMaxPages`           | `number`                                             | —       | Maximum scan pages before aborting                 |

### ID Generation

| Option                | Type                           | Default               | Description                              |
| --------------------- | ------------------------------ | --------------------- | ---------------------------------------- |
| `customIdGenerator`   | `(props: { model }) => string` | `crypto.randomUUID()` | Custom ID generator (ULID, nanoid, cuid) |
| `disableIdGeneration` | `boolean`                      | `false`               | Disable automatic ID generation          |

### Data Transformation

| Option                   | Type                     | Description                      |
| ------------------------ | ------------------------ | -------------------------------- |
| `mapKeysTransformInput`  | `Record<string, string>` | Map field names before saving    |
| `mapKeysTransformOutput` | `Record<string, string>` | Map field names when reading     |
| `customTransformInput`   | `(props) => any`         | Custom transform for input data  |
| `customTransformOutput`  | `(props) => any`         | Custom transform for output data |

### Other Options

| Option        | Type                      | Default | Description                       |
| ------------- | ------------------------- | ------- | --------------------------------- |
| `transaction` | `boolean`                 | `false` | Enable adapter-layer transactions |
| `debugLogs`   | `DBAdapterDebugLogOption` | —       | Better Auth debug logging options |

## 📝 Behavior Notes

### Date Handling

The adapter has `supportsDates` disabled. Date fields are stored as ISO 8601 strings.

### ID Generation

By default, the adapter uses `crypto.randomUUID()` for ID generation. Customize with:

```ts
import { ulid } from "ulid";

const adapter = dynamodbAdapter({
  documentClient,
  indexNameResolver,
  customIdGenerator: ({ model }) => ulid(),
});
```

> ⚠️ `supportsNumericIds` is disabled. Do not enable Better Auth numeric ID generation.

### Scan Protection

Table scans are guarded by `scanMaxPages`. Queries that cannot use an index will throw if `scanMaxPages` is not configured.

## 💡 Examples

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

### Custom index resolvers

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

## 🧪 Local Development

Tests use DynamoDB Local by default.

### Environment Variables

| Variable                | Default                 | Description                          |
| ----------------------- | ----------------------- | ------------------------------------ |
| `DYNAMODB_ENDPOINT`     | `http://localhost:8000` | DynamoDB endpoint URL                |
| `AWS_ACCESS_KEY_ID`     | `fakeAccessKeyId`       | AWS access key (any value for local) |
| `AWS_SECRET_ACCESS_KEY` | `fakeSecretAccessKey`   | AWS secret key (any value for local) |

### Running Tests

```bash
# Start DynamoDB Local (via Docker)
docker run -p 8000:8000 amazon/dynamodb-local

# Run tests
bun run test

# Run tests with coverage
bun run test:cov
```

## 📄 License

This is free and unencumbered software released into the public domain.
See [UNLICENSE](./UNLICENSE) for details.
