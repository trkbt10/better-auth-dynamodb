/**
 * @file DynamoDB adapter implementation for Better Auth.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type {
	AdapterFactoryCustomizeAdapterCreator,
	AdapterFactoryOptions,
	DBAdapter,
	Where,
} from "@better-auth/core/db/adapter";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { AdapterMethodContext } from "./adapter-methods/types";
import { randomUUID } from "node:crypto";
import type { DynamoDBAdapterConfig } from "./adapter-config";
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
import { applyClientFilter } from "./dynamodb/fetcher/client-filter";
import { createFetchCount } from "./dynamodb/fetcher/fetch-count";
import { createFetchItems } from "./dynamodb/fetcher/fetch-items";
import { resolveScanLimit } from "./dynamodb/fetcher/scan-limit";
import { resolveTableName } from "./dynamodb/keys/table-name";
import {
	createTransactionState,
	executeTransaction,
	type DynamoDBTransactionState,
} from "./dynamodb/operations/transaction";
import type { ResolvedDynamoDBAdapterConfig } from "./adapter-config";
import type {
	DynamoDBWhere,
	DynamoDBWhereConnector,
	DynamoDBWhereOperator,
} from "./dynamodb/types";
import type { DynamoDBItem } from "./dynamodb/where/where-evaluator";

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

const resolveWhereOperator = (
	operator: Where["operator"],
): DynamoDBWhereOperator => {
	if (operator) {
		return operator as DynamoDBWhereOperator;
	}
	return "eq";
};

const resolveWhereConnector = (
	connector: Where["connector"],
): DynamoDBWhereConnector => {
	if (connector) {
		return connector;
	}
	return "AND";
};

const mapWhereFilters = (where: Where[] | undefined): DynamoDBWhere[] | undefined => {
	if (!where || where.length === 0) {
		return undefined;
	}
	return where.map((entry) => ({
		field: entry.field,
		operator: resolveWhereOperator(entry.operator),
		value: entry.value,
		connector: resolveWhereConnector(entry.connector),
	}));
};

const createDynamoDbCustomizer = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	transactionState?: DynamoDBTransactionState | undefined;
}): AdapterFactoryCustomizeAdapterCreator => {
	const { documentClient, adapterConfig, transactionState } = props;

	return ({ getFieldName, getDefaultModelName }) => {
		const fetchItems = createFetchItems({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});
		const fetchCount = createFetchCount({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});
		const applyClientFilterForFetch = (input: {
			items: DynamoDBItem[];
			where: DynamoDBWhere[] | undefined;
			model: string;
			requiresClientFilter: boolean;
		}) =>
			applyClientFilter({
				items: input.items,
				where: input.where,
				model: input.model,
				getFieldName,
				requiresClientFilter: input.requiresClientFilter,
			});

		const getPrimaryKeyName = (model: string) =>
			getFieldName({ model, field: "id" });

		const resolveModelTableName = (model: string) =>
			resolveTableName({
				model,
				getDefaultModelName,
				config: adapterConfig,
			});

		const methodContext: AdapterMethodContext = {
			documentClient,
			fetchItems,
			fetchCount,
			applyClientFilter: applyClientFilterForFetch,
			resolveScanLimit,
			transactionState,
			getFieldName,
			resolveModelTableName,
			getPrimaryKeyName,
			mapWhereFilters,
		};

		return {
			create: createCreateMethod(methodContext),
			findOne: createFindOneMethod(methodContext),
			findMany: createFindManyMethod(methodContext),
			count: createCountMethod(methodContext),
			update: createUpdateMethod(methodContext),
			updateMany: createUpdateManyMethod(methodContext),
			delete: createDeleteMethod(methodContext),
			deleteMany: createDeleteManyMethod(methodContext),
		};
	};
};

export const dynamodbAdapter = (config: DynamoDBAdapterConfig) => {
	const resolvedConfig = resolveAdapterConfig(config);
	const documentClient = ensureDocumentClient(resolvedConfig.documentClient);
	const lazyState: {
		options: BetterAuthOptions | null;
		adapter: ((options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>) | null;
	} = {
		options: null,
		adapter: null,
	};
	const getLazyAdapter = (): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> => {
		if (!lazyState.adapter) {
			throw new DynamoDBAdapterError(
				"MISSING_CLIENT",
				"DynamoDB adapter is not initialized.",
			);
		}
		return lazyState.adapter;
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
			if (!lazyState.options || !lazyState.adapter) {
				throw new DynamoDBAdapterError(
					"MISSING_CLIENT",
					"DynamoDB adapter options are not initialized.",
				);
			}
			const state = createTransactionState();
			const transactionAdapter = createAdapterFactory({
				config: { ...adapterOptions.config, transaction: false },
				adapter: createDynamoDbCustomizer({
					documentClient,
					adapterConfig: resolvedConfig,
					transactionState: state,
				}),
			})(lazyState.options);

			const result = await cb(transactionAdapter);
			await executeTransaction({ documentClient, state });
			return result;
		};
	}

	lazyState.adapter = createAdapterFactory(adapterOptions);

	return (options: BetterAuthOptions): DBAdapter<BetterAuthOptions> => {
		lazyState.options = options;
		return getLazyAdapter()(options);
	};
};
