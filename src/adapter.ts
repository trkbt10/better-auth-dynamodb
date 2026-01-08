/**
 * @file DynamoDB adapter implementation for Better Auth.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type {
  AdapterFactoryCustomizeAdapterCreator,
  AdapterFactoryOptions,
  DBAdapter,
  DBAdapterDebugLogOption,
} from "@better-auth/core/db/adapter";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { createCountMethod } from "./adapter-methods/count";
import { createCreateMethod } from "./adapter-methods/create";
import { createDeleteManyMethod } from "./adapter-methods/delete-many";
import { createDeleteMethod } from "./adapter-methods/delete";
import { createFindManyMethod } from "./adapter-methods/find-many";
import { createFindOneMethod } from "./adapter-methods/find-one";
import { createUpdateManyMethod } from "./adapter-methods/update-many";
import { createUpdateMethod } from "./adapter-methods/update";
import { DynamoDBAdapterError } from "./dynamodb/errors/errors";
import { createTransactionState, executeTransaction, type DynamoDBTransactionState } from "./dynamodb/ops/transaction";
import type { AdapterClientContainer } from "./adapter-methods/client-container";
import type { CountMethodOptions } from "./adapter-methods/count";
import type { CreateMethodOptions } from "./adapter-methods/create";
import type { DeleteMethodOptions } from "./adapter-methods/delete-many";
import type { FindManyOptions } from "./adapter-methods/find-many";
import type { UpdateMethodOptions } from "./adapter-methods/update-many";

export type DynamoDBTableNameResolver = (modelName: string) => string;

export type DynamoDBIndexKeySchema = {
  partitionKey: string;
  sortKey?: string | undefined;
};

export type DynamoDBAdapterConfig = {
  documentClient: DynamoDBDocumentClient;
  debugLogs?: DBAdapterDebugLogOption | undefined;
  usePlural?: boolean | undefined;
  tableNamePrefix?: string | undefined;
  tableNameResolver?: DynamoDBTableNameResolver | undefined;
  scanMaxPages?: number | undefined;
  indexNameResolver: (props: { model: string; field: string }) => string | undefined;
  indexKeySchemaResolver?:
    | ((props: { model: string; indexName: string }) => DynamoDBIndexKeySchema | undefined)
    | undefined;
  transaction?: boolean | undefined;
};

export type ResolvedDynamoDBAdapterConfig = {
  documentClient: DynamoDBDocumentClient;
  debugLogs: DBAdapterDebugLogOption | undefined;
  usePlural: boolean;
  tableNamePrefix?: string | undefined;
  tableNameResolver?: DynamoDBTableNameResolver | undefined;
  scanMaxPages?: number | undefined;
  indexNameResolver: (props: { model: string; field: string }) => string | undefined;
  indexKeySchemaResolver?:
    | ((props: { model: string; indexName: string }) => DynamoDBIndexKeySchema | undefined)
    | undefined;
  transaction: boolean;
};

const ensureDocumentClient = (documentClient: DynamoDBDocumentClient | undefined): DynamoDBDocumentClient => {
  if (!documentClient) {
    throw new DynamoDBAdapterError("MISSING_CLIENT", "DynamoDB adapter requires a DynamoDBDocumentClient instance.");
  }
  return documentClient;
};

const createDynamoDbCustomizer = (props: {
  documentClient: DynamoDBDocumentClient;
  adapterConfig: ResolvedDynamoDBAdapterConfig;
  transactionState?: DynamoDBTransactionState | undefined;
}): AdapterFactoryCustomizeAdapterCreator => {
  const { documentClient, adapterConfig, transactionState } = props;

  return ({ getFieldName, getDefaultModelName }) => {
    const adapterClient: AdapterClientContainer = { documentClient };
    const sharedOptions: FindManyOptions = {
      adapterConfig,
      getFieldName,
      getDefaultModelName,
    };
    const countOptions: CountMethodOptions = sharedOptions;
    const updateOptions: UpdateMethodOptions = {
      ...sharedOptions,
      transactionState,
    };
    const deleteOptions: DeleteMethodOptions = {
      ...sharedOptions,
      transactionState,
    };
    const createOptions: CreateMethodOptions = {
      adapterConfig,
      getDefaultModelName,
      transactionState,
    };

    return {
      create: createCreateMethod(adapterClient, createOptions),
      findOne: createFindOneMethod(adapterClient, sharedOptions),
      findMany: createFindManyMethod(adapterClient, sharedOptions),
      count: createCountMethod(adapterClient, countOptions),
      update: createUpdateMethod(adapterClient, updateOptions),
      updateMany: createUpdateManyMethod(adapterClient, updateOptions),
      delete: createDeleteMethod(adapterClient, deleteOptions),
      deleteMany: createDeleteManyMethod(adapterClient, deleteOptions),
    };
  };
};

export const dynamodbAdapter = (config: DynamoDBAdapterConfig) => {
  if (!config.indexNameResolver) {
    throw new DynamoDBAdapterError(
      "MISSING_INDEX_RESOLVER",
      "DynamoDB adapter requires indexNameResolver.",
    );
  }
  const resolvedConfig: ResolvedDynamoDBAdapterConfig = {
    documentClient: config.documentClient,
    debugLogs: config.debugLogs,
    usePlural: config.usePlural ?? false,
    tableNamePrefix: config.tableNamePrefix,
    tableNameResolver: config.tableNameResolver,
    scanMaxPages: config.scanMaxPages,
    indexNameResolver: config.indexNameResolver,
    indexKeySchemaResolver: config.indexKeySchemaResolver,
    transaction: config.transaction ?? false,
  };
  const documentClient = ensureDocumentClient(resolvedConfig.documentClient);
  // Matches official adapters (prisma/drizzle/mongodb); e.g.:
  //   return (options) => { lazyOptions = options; return adapter(options); }
  //   transaction: (cb) => cb(createAdapterFactory(...)(lazyOptions))
  // Ref: better-auth/dist/adapters/prisma-adapter/prisma-adapter.mjs
  // Keep the last BetterAuth options for transaction callbacks.
  const lazyOptions: { value: BetterAuthOptions | null } = { value: null };

  const adapterOptions: AdapterFactoryOptions = {
    config: {
      adapterId: "dynamodb-adapter",
      adapterName: "DynamoDB Adapter",
      usePlural: resolvedConfig.usePlural,
      debugLogs: resolvedConfig.debugLogs ?? false,
      supportsArrays: true,
      supportsJSON: true,
      supportsUUIDs: true,
      supportsNumericIds: false,
      supportsDates: false,
      customIdGenerator() {
        return randomUUID();
      },
      transaction: false,
    },
    adapter: createDynamoDbCustomizer({
      documentClient,
      adapterConfig: resolvedConfig,
    }),
  };

  if (resolvedConfig.transaction) {
    adapterOptions.config.transaction = async (cb) => {
      const options = lazyOptions.value;
      if (!options) {
        throw new DynamoDBAdapterError("MISSING_CLIENT", "DynamoDB adapter options are not initialized.");
      }
      const state = createTransactionState();
      const transactionAdapter = createAdapterFactory({
        config: { ...adapterOptions.config, transaction: false },
        adapter: createDynamoDbCustomizer({
          documentClient,
          adapterConfig: resolvedConfig,
          transactionState: state,
        }),
      })(options);

      const result = await cb(transactionAdapter);
      await executeTransaction({ documentClient, state });
      return result;
    };
  }

  const adapterFactory = createAdapterFactory(adapterOptions);

  return (options: BetterAuthOptions): DBAdapter<BetterAuthOptions> => {
    lazyOptions.value = options;
    return adapterFactory(options);
  };
};
