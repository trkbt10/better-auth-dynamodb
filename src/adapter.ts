/**
 * @file DynamoDB adapter implementation for Better Auth.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type {
	AdapterFactoryCustomizeAdapterCreator,
	AdapterFactoryOptions,
	DBAdapter,
} from "@better-auth/core/db/adapter";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { DynamoDBAdapterConfig, ResolvedDynamoDBAdapterConfig } from "./adapter-config";
import { resolveAdapterConfig } from "./adapter-config";
import { createCountMethod } from "./adapter-methods/count";
import { createCreateMethod } from "./adapter-methods/create";
import { createDeleteManyMethod } from "./adapter-methods/delete-many";
import { createDeleteMethod } from "./adapter-methods/delete";
import { createFindManyMethod } from "./adapter-methods/find-many";
import { createFindOneMethod } from "./adapter-methods/find-one";
import { createUpdateManyMethod } from "./adapter-methods/update-many";
import { createUpdateMethod } from "./adapter-methods/update";
import { DynamoDBAdapterError } from "./dynamodb/errors/errors";
import {
	createTransactionState,
	executeTransaction,
	type DynamoDBTransactionState,
} from "./dynamodb/query-utils/transaction";
import type { AdapterClientContainer } from "./adapter-methods/client-container";
import type { CountMethodOptions } from "./adapter-methods/count";
import type { CreateMethodOptions } from "./adapter-methods/create";
import type { DeleteMethodOptions } from "./adapter-methods/delete-many";
import type { FindManyOptions } from "./adapter-methods/find-many";
import type { UpdateMethodOptions } from "./adapter-methods/update-many";

const ensureDocumentClient = (
	documentClient: DynamoDBDocumentClient | undefined,
): DynamoDBDocumentClient => {
	if (!documentClient) {
		throw new DynamoDBAdapterError(
			"MISSING_CLIENT",
			"DynamoDB adapter requires a DynamoDBDocumentClient instance.",
		);
	}
	return documentClient;
};

const createDynamoDbCustomizer = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	transactionState?: DynamoDBTransactionState | undefined;
}): AdapterFactoryCustomizeAdapterCreator => {
	const { documentClient, adapterConfig, transactionState } = props;

	return ({ getFieldName, getDefaultModelName, getFieldAttributes }) => {
		const adapterClient: AdapterClientContainer = { documentClient };
		const sharedOptions: FindManyOptions = {
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes,
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
	const resolvedConfig = resolveAdapterConfig(config);
	const documentClient = ensureDocumentClient(resolvedConfig.documentClient);
	const currentOptions: { value: BetterAuthOptions | null } = { value: null };
	const resolveOptions = (): BetterAuthOptions => {
		if (!currentOptions.value) {
			throw new DynamoDBAdapterError(
				"MISSING_CLIENT",
				"DynamoDB adapter options are not initialized.",
			);
		}
		return currentOptions.value;
	};

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
			const options = resolveOptions();
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
		currentOptions.value = options;
		return adapterFactory(options);
	};
};
