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
- 🔌 **Plugin Support** — Automatic schema generation for Better Auth plugins
- 📊 **Optimized GSI Configurations** — Multi-table schema with smart indexing
- ⚡ **Transaction Support** — Atomic operations for data consistency
- 🎯 **Flexible Table Naming** — Prefix or custom resolver patterns
- 🛠️ **Built-in Table Creation** — Zero-config setup utilities
- 🔒 **TypeScript-First** — Complete type safety out of the box

## 📋 Requirements

| Requirement  | Version                                                    |
| ------------ | ---------------------------------------------------------- |
| Node.js      | 18+                                                        |
| AWS DynamoDB | Local or Cloud                                             |
| AWS SDK      | v3                                                         |
| Better Auth  | 1.x — the test suite runs against 1.7 (see Local Development) |

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
npm install github:trkbt10/better-auth-dynamodb#v0.2.0

# specific branch
npm install github:trkbt10/better-auth-dynamodb#main
```

</details>

## 🚀 Quick Start

### Basic Setup (Core Tables Only)

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import { coreTableSchemas, createIndexResolversFromSchemas, dynamodbAdapter } from "better-auth-dynamodb";

// 1. Create DynamoDB client
const client = new DynamoDBClient({ region: "us-east-1" });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// 2. Create index resolvers from core schemas
const { indexNameResolver, indexKeySchemaResolver } = createIndexResolversFromSchemas(coreTableSchemas);

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
  database: adapter,
});
```

### With Plugins

Use `generateTableSchemas()` to automatically generate schemas that match your Better Auth configuration including plugins:

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import { twoFactor, organization } from "better-auth/plugins";
import { createIndexResolversFromSchemas, dynamodbAdapter, generateTableSchemas } from "better-auth-dynamodb";

// 1. Define your Better Auth config (used for both schema generation and auth setup)
const plugins = [twoFactor(), organization()];

// 2. Generate schemas matching your Better Auth config
const schemas = generateTableSchemas({ plugins });

// 3. Create index resolvers from generated schemas
const { indexNameResolver, indexKeySchemaResolver } = createIndexResolversFromSchemas(schemas);

// 4. Create DynamoDB client
const client = new DynamoDBClient({ region: "us-east-1" });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// 5. Configure the adapter
const adapter = dynamodbAdapter({
  documentClient,
  tableNamePrefix: "better_auth_",
  scanMaxPages: 25,
  indexNameResolver,
  indexKeySchemaResolver,
  transaction: true,
});

// 6. Use with Better Auth
const auth = betterAuth({
  database: adapter,
  plugins,
});
```

## 🗄️ Table Setup

Before using the adapter, create the required DynamoDB tables.

### Using the built-in helper (Core Tables)

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { applyTableSchemas, coreTableSchemas } from "better-auth-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

// Apply table name prefix to schemas
const tables = coreTableSchemas.map((schema) => ({
  ...schema,
  tableName: `better_auth_${schema.tableName}`,
}));

await applyTableSchemas({ client, tables });
```

### Using the built-in helper (With Plugins)

```ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { twoFactor, organization } from "better-auth/plugins";
import { applyTableSchemas, generateTableSchemas } from "better-auth-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

// Generate schemas from Better Auth config
const schemas = generateTableSchemas({ plugins: [twoFactor(), organization()] });

// Apply table name prefix
const tables = schemas.map((schema) => ({
  ...schema,
  tableName: `better_auth_${schema.tableName}`,
}));

await applyTableSchemas({ client, tables });
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

    this.userTable.addGlobalSecondaryIndex({
      indexName: "user_email_idx",
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.userTable.addGlobalSecondaryIndex({
      indexName: "user_username_idx",
      partitionKey: { name: "username", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
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
      indexName: "account_accountId_idx",
      partitionKey: { name: "accountId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
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
    `${userTable.tableArn}/index/*`,
    `${sessionTable.tableArn}/index/*`,
    `${accountTable.tableArn}/index/*`,
    `${verificationTable.tableArn}/index/*`,
  ],
});

// If using transactions (transaction: true in adapter config)
const transactionPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ["dynamodb:TransactWriteItems", "dynamodb:ConditionCheckItem"],
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
| `dynamodb:ConditionCheckItem` | Guards on unchanged rows inside a transaction (if `transaction: true`) |

### Table Schema Overview (coreTableSchemas)

| Table          | Primary Key | Global Secondary Indexes                              |
| -------------- | ----------- | ----------------------------------------------------- |
| `user`         | `id` (HASH) | `email`, `username`                                   |
| `session`      | `id` (HASH) | `userId + createdAt`, `token + createdAt`             |
| `account`      | `id` (HASH) | `accountId`, `userId`, `providerId + accountId`       |
| `verification` | `id` (HASH) | `identifier + createdAt`                              |

## ⚙️ Configuration

### Required Options

| Option              | Type                                               | Description                                              |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| `documentClient`    | `DynamoDBDocumentClient`                           | AWS SDK DynamoDB Document Client instance                |
| `indexNameResolver` | `(props: { model, field }) => string \| undefined` | Resolves field names to GSI names for query optimization |

### Table Naming

| Option              | Type                            | Default | Description                                                  |
| ------------------- | ------------------------------- | ------- | ------------------------------------------------------------ |
| `tableNamePrefix`   | `string`                        | —       | Prefix for all table names (e.g., `"auth_"` → `auth_user`); a custom `modelName` is honored |
| `tableNameResolver` | `(modelName: string) => string` | —       | Custom function for table name resolution                    |
| `usePlural`         | `boolean`                       | `false` | Passed to Better Auth's adapter factory. Table and index names are not pluralized |

### Query & Index Options

| Option                   | Type                                                 | Default   | Description                                        |
| ------------------------ | ---------------------------------------------------- | --------- | -------------------------------------------------- |
| `indexKeySchemaResolver` | `(props) => { partitionKey, sortKey? } \| undefined` | —         | Resolves GSI key schemas for composite key queries |
| `scanMaxPages`           | `number`                                             | —         | Maximum scan pages before aborting                 |
| `scanPageLimitMode`      | `"throw" \| "unbounded"`                             | `"throw"` | Behavior when scan exceeds page limit              |

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

| Option                    | Type                      | Default | Description                                      |
| ------------------------- | ------------------------- | ------- | ------------------------------------------------ |
| `transaction`             | `boolean`                 | `false` | Enable adapter-layer transactions (see Behavior Notes) |
| `debugLogs`               | `DBAdapterDebugLogOption` | —       | Better Auth debug logging options                |
| `explainQueryPlans`       | `boolean`                 | `false` | Print query plan decisions to console            |
| `explainDynamoOperations` | `boolean`                 | `false` | Print DynamoDB operation summaries to console    |

### Schema Generation Options

Options for `generateTableSchemas()`:

| Option                        | Type                              | Default | Description                                              |
| ----------------------------- | --------------------------------- | ------- | -------------------------------------------------------- |
| `compositeIndexes`            | `Record<string, CompositeIndex[]>` | —       | Additional composite indexes (PK + SK) per table          |
| `disableAutoCompositeIndexes` | `boolean`                         | `false` | Disable default composite indexes                         |
| `indexReferences`             | `boolean`                         | `true`  | Auto-create GSI for foreign key fields (references)       |
| `disableSchemaExtensions`     | `boolean`                         | `false` | Disable default schema extensions for plugin fixes        |
| `schemaExtensions`            | `SchemaExtensions`                | —       | Additional schema extensions for plugin field adjustments |

<details>
<summary>📘 Custom Composite Indexes Example</summary>

```ts
import { generateTableSchemas } from "better-auth-dynamodb";

const schemas = generateTableSchemas(
  { plugins: [...] },
  {
    compositeIndexes: {
      session: [
        { partitionKey: "userId", sortKey: "expiresAt" },
      ],
      customTable: [
        { partitionKey: "tenantId", sortKey: "createdAt" },
      ],
    },
  }
);
```

</details>

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

### Atomic Methods (`consumeOne` / `incrementOne`)

Better Auth 1.6 and later consumes single-use rows (verification tokens, device codes) with `consumeOne` and mutates guarded counters (database rate limiting, team seats, two-factor lockouts) with `incrementOne`. The adapter implements both natively as one keyed, conditional DynamoDB write:

| Method         | DynamoDB request                                                                   | Result                                              |
| -------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| `consumeOne`   | `DeleteItem` with the where clause as `ConditionExpression`, `ReturnValues=ALL_OLD` | The deleted row, or `null` when no row matched      |
| `incrementOne` | `UpdateItem` with the where clause as `ConditionExpression`, `ReturnValues=ALL_NEW` | The updated row, or `null` when the guard missed    |

- Concurrent `consumeOne` calls for one row hand it to exactly one caller. Concurrent `incrementOne` calls never lose an increment and never pass a guard such as `count < max`.
- `incrementOne` adds the delta inside DynamoDB. A counter that is absent or `null` counts as `0`; any other non-numeric value is rejected with `INVALID_UPDATE`.
- A where clause that selects the row by `id` is resolved without a query: `consumeOne` is a single request when DynamoDB can evaluate the whole where clause, and `incrementOne` reads the row with a strongly consistent `GetItem` first.
- Any other where clause is resolved through an index or scan first, like `update` and `delete`. That read is eventually consistent, so the conditional write is what decides. When its condition fails, the row is read again by its key, strongly consistently: a row that is gone or no longer matches is skipped (and `null` is returned when no other row matches), a row that still matches is written again from its current values.
- A row that keeps changing under the write is retried up to 5 times; then the method throws `ATOMIC_WRITE_CONTENTION` instead of reporting "no row matched".
- With `transaction: true`, the write is buffered like every other write of the transaction and the returned row is the one read inside it. The commit requires the attributes that row was read with to be unchanged; otherwise it fails with `TransactionCanceledException`.

### Single-Row Writes

- `create` fails with `DUPLICATE_PRIMARY_KEY` when the primary key is already taken (`PutItem` with `attribute_not_exists`). It never replaces a row. Better Auth relies on this to make a deterministic id a first-writer-wins gate.
- `update` only changes a row that still exists (`attribute_exists`). If the row was deleted after it was read, the update affects nothing instead of creating a partial row.
- `update` assigns the given attributes, each as a whole value: a number is set, not advanced, and a list or JSON field is replaced, not merged. Use `incrementOne` for counters.
- `deleteMany` returns the number of rows it actually deleted.
- Uniqueness of a field other than `id` is not enforced: DynamoDB has no unique constraint on non-key attributes.

### Transactions

With `transaction: true`, `adapter.transaction()` buffers its writes and commits them in one `TransactWriteItems` request.

- Reads inside the transaction (`findOne`, `findMany`, `count`, joins) see the writes made earlier in it.
- Several writes to one row are folded into one operation, as `TransactWriteItems` allows a single operation per item.
- A transaction writes at most 100 rows (the `TransactWriteItems` limit); a larger one fails with `TRANSACTION_LIMIT` when it commits.
- Nothing is written when the callback throws. When a condition fails at commit (a created id is taken, an updated row is gone, a row read by `consumeOne` / `incrementOne` changed), DynamoDB cancels the whole request with `TransactionCanceledException`.
- Rows other transactions write in the meantime are not locked: isolation is optimistic and enforced at commit.

### Where Clauses

- `eq null` matches a row whose field is `NULL` or absent; `ne null` matches a row whose field holds a value.
- `mode: "insensitive"` and `ends_with` have no DynamoDB counterpart. They are evaluated in memory after the rows are read, so they cannot use an index for that entry.
- A where clause may name a key attribute outside the key condition (a repeated key, a range on an index sort key). DynamoDB does not accept those in a `FilterExpression`; the adapter evaluates them in memory.

### Null Values and Indexes

DynamoDB cannot store `NULL` in an attribute that a global secondary index uses as its key. A `null` value of such a field (for example a nullable foreign key) is written as a missing attribute, which keeps the row out of that index, and is read back as `null`.

### Table Names and `modelName`

With `tableNamePrefix`, a table is named `prefix + modelName`, where `modelName` is the model name of the Better Auth schema (`user: { modelName: "app_user" }` → `auth_app_user`). `generateTableSchemas` uses the same name. `tableNameResolver` receives the default model name (`user`).

### Upgrading from 0.2

0.3 follows Better Auth 1.7 and changes behavior in a few places. Check these before upgrading an existing deployment:

| Change | Affects you when | What to do |
| ------ | ---------------- | ---------- |
| With `tableNamePrefix`, tables are named after the schema's `modelName` | You set a custom `modelName` and created the tables under the default name (`auth_user`) | Rename or re-create the tables, or map the names yourself with `tableNameResolver` |
| Default composite indexes also apply to models with a custom `modelName` | You set a custom `modelName` for `session`, `account` or `verification` and use `generateTableSchemas` | Re-run `applyTableSchemas` (or deploy the regenerated schema) so the indexes exist before the adapter queries them |
| Index resolvers are asked with the schema model name (`user`), also with `usePlural` | You use `usePlural` with hand-written resolvers keyed by the plural name (`users`) | Key the resolvers by the schema model name |
| A custom-named `session` gets the composite indexes instead of the single-field `<name>_userId_idx` / `<name>_token_idx` | Same as above | The old single-field indexes are no longer used; `applyTableSchemas` does not delete them, remove them yourself |
| `create` rejects a primary key that is taken | Code relied on `create` replacing a row with the same `id` | Use `update` |
| `update` assigns the given attributes as whole values | Code advanced a counter with `update({ count: count + 1 })` and relied on concurrent calls adding up, or relied on list / JSON fields being merged | Use `incrementOne` for counters (Better Auth 1.6+ does) |
| `findMany` applies `select` | Code read fields it did not select | Select them |
| `eq null` also matches a missing attribute; `mode: "insensitive"` is honored | Queries with those conditions return different rows, and they are evaluated in memory, so they need `scanMaxPages` when no other condition can use an index | Review such queries |
| A null value of an index key attribute is stored as a missing attribute | Rows are read by other clients that expect a `NULL` attribute | Treat the missing attribute as null |
| Filtered queries and scans read full pages | `scanMaxPages` now counts pages of up to 1 MB instead of single evaluated items | Revisit a `scanMaxPages` that was tuned to the old behavior |
| `indexNameResolver` is called for every field of a model | A hand-written resolver throws for fields it does not know | Return `undefined` for them |
| `dynamodb:GetItem` is used (it was listed as required before, but not called) | The IAM policy omits it | Add the action; `consumeOne` / `incrementOne` need it |
| Transactions allow 100 rows instead of 25, checked at commit | Code relied on `TRANSACTION_LIMIT` being thrown inside the callback at 25 writes | Expect it from `adapter.transaction()` |
| `dynamodb:ConditionCheckItem` | You use `transaction: true` | Add the action to the IAM policy |

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
  const indexes: Record<string, Record<string, string>> = {
    user: { email: "user_email_idx", username: "user_username_idx" },
    session: { userId: "session_userId_idx", token: "session_token_idx" },
    account: {
      accountId: "account_accountId_idx",
      userId: "account_userId_idx",
      providerId: "account_providerId_accountId_idx",
    },
    verification: { identifier: "verification_identifier_idx" },
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

# ... or without Docker, from the DynamoDB Local download (needs Java 17+)
java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -inMemory -port 8000

# Run tests
bun run test

# Run tests with coverage
bun run test:cov
```

The suite includes Better Auth's official adapter tests (`@better-auth/test-utils`: normal, transactions, auth-flow, joins, case-insensitive and uuid suites) and runs them, like every spec that depends on conditional writes, against DynamoDB Local. `tools/plugin-docs.spec.ts` fetches the Better Auth documentation and needs network access.

### Chaos Specs

DynamoDB Local answers every read from the latest write, in the order the requests arrive, and never fails. A real table does none of that: index reads lag, concurrent requests interleave, requests are throttled and responses get lost. `spec/chaos/` runs the adapter against a cluster that does all of it. The cluster is the in-memory fake (itself verified against DynamoDB Local by `spec/stateful-document-client.spec.ts`), extended with:

| Fault | What happens |
| ----- | ------------ |
| Replication lag | An index read, or a table read without `ConsistentRead`, is answered from an earlier state; each item can lag on its own, so a read may show a combination the table never held |
| Interleaving | Concurrent operations advance one request at a time, in a random order |
| Rejected requests | A request fails before it is applied (throttling); a transaction is cancelled by a conflict |
| Lost responses | A write is applied but its response is lost, and optionally sent again as the AWS SDK retries |
| Short pages | A Query / Scan page ends after one or two evaluated items, so the rest has to be fetched through `LastEvaluatedKey` |
| Partial batches | A `BatchGetItem` hands some of its keys back as `UnprocessedKeys` |

Every decision is drawn from a seed. Each scenario runs concurrent callers under nine fault profiles (from interleaving alone to everything at once) and checks, for every write the cluster applied, the invariants the adapter promises:

- a single-use row is handed out at most once, and only while it matches the where clause;
- a guarded counter moves by exactly the requested delta and never past its guard;
- a create never replaces a row; an update never resurrects one or changes what it did not assign; list and JSON values are written whole;
- a transaction is applied in full or not at all, reads its own writes, and takes a fixed id at most once;
- a read of rows nobody changes is exact: every row once, in the requested order;
- through Better Auth: a reset token changes the password at most once, and a database rate limit admits at most `max`.

What the specs do not assert is freshness: a row written a moment ago may be missing from an index read, on the simulated cluster as on DynamoDB. The specs for the tooling itself (`spec/chaos/chaos-cluster.spec.ts`) check that each fault really happens, and every profile fails its run if the faults it names were never injected.

```bash
# part of `bun run test` (40 seeds per profile; needs no DynamoDB Local)
bunx vitest --run spec/chaos

# more seeds (CHAOS_FLOW_RUNS for the Better Auth flows, which hash passwords)
CHAOS_RUNS=1000 CHAOS_FLOW_RUNS=60 bunx vitest --run spec/chaos --testTimeout=600000

# replay the seed a failure reported
CHAOS_SEED=1234 bunx vitest --run spec/chaos
```

A failing run prints its seed, the broken invariants and the requests in the order they were answered.

## 📄 License

This is free and unencumbered software released into the public domain.
See [UNLICENSE](./UNLICENSE) for details.
