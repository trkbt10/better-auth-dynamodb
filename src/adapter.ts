/**
 * @file DynamoDB adapter implementation for Better Auth.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type {
	AdapterFactoryCustomizeAdapterCreator,
	AdapterFactoryOptions,
	DBAdapter,
	JoinConfig,
	Where,
} from "@better-auth/core/db/adapter";
import { createAdapterFactory } from "@better-auth/core/db/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	DeleteCommand,
	PutCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "node:crypto";
import type { DynamoDBAdapterConfig } from "./adapter-config";
import { resolveAdapterConfig } from "./adapter-config";
import { DynamoDBAdapterError } from "./dynamodb/errors/errors";
import { buildUpdateExpression } from "./dynamodb/expressions/update-expression";
import { createAdapterFetcher } from "./dynamodb/fetcher/fetcher";
import { buildPrimaryKey } from "./dynamodb/keys/primary-key";
import { resolveTableName } from "./dynamodb/keys/table-name";
import {
	addTransactionOperation,
	createTransactionState,
	executeTransaction,
	type DynamoDBTransactionState,
} from "./dynamodb/operations/transaction";
import { applySort } from "./dynamodb/sorting/record-sort";
import type { ResolvedDynamoDBAdapterConfig } from "./adapter-config";
import type { DynamoDBItem } from "./dynamodb/where/where-evaluator";
import type {
	DynamoDBWhere,
	DynamoDBWhereConnector,
	DynamoDBWhereOperator,
} from "./dynamodb/types";

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

const applyUpdateData = <T extends Record<string, unknown>>(
	item: T,
	update: Record<string, unknown>,
): T => {
	const entries = Object.entries(update).filter(
		([, value]) => value !== undefined,
	);
	const updates = entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
		acc[key] = value;
		return acc;
	}, {});
	return { ...item, ...updates };
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
		const fetcher = createAdapterFetcher({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});

		const getPrimaryKeyName = (model: string) =>
			getFieldName({ model, field: "id" });

		const resolveModelTableName = (model: string) =>
			resolveTableName({
				model,
				getDefaultModelName,
				config: adapterConfig,
			});

		return {
			async create<T extends Record<string, unknown>>({
				model,
				data,
			}: {
				model: string;
				data: T;
			}) {
				const tableName = resolveModelTableName(model);
				if (transactionState) {
					addTransactionOperation(transactionState, {
						kind: "put",
						tableName,
						item: data as Record<string, NativeAttributeValue>,
					});
					return data;
				}
				await documentClient.send(
					new PutCommand({
						TableName: tableName,
						Item: data,
					}),
				);
				return data;
			},
			async findOne<T>({
				model,
				where,
				select,
				join,
			}: {
				model: string;
				where: Where[];
				select?: string[] | undefined;
				join?: JoinConfig | undefined;
			}) {
				if (join) {
					throw new DynamoDBAdapterError(
						"UNSUPPORTED_JOIN",
						"DynamoDB adapter does not support joins.",
					);
				}

				const fetchResult = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where),
					limit: 1,
				});
				const filteredItems = fetcher.applyClientFilter({
					items: fetchResult.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: fetchResult.requiresClientFilter,
				});

				if (filteredItems.length === 0) {
					return null;
				}

				const item = filteredItems[0] as T;
				if (!select || select.length === 0) {
					return item;
				}

				const selection: Record<string, unknown> = {};
				select.forEach((field) => {
					const resolvedField = getFieldName({ model, field });
					if (resolvedField in (item as Record<string, unknown>)) {
						selection[resolvedField] = (item as Record<string, unknown>)[
							resolvedField
						];
					}
				});

				return selection as T;
			},
			async findMany<T>({
				model,
				where,
				limit,
				sortBy,
				offset,
				join,
			}: {
				model: string;
				where?: Where[] | undefined;
				limit: number;
				sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
				offset?: number | undefined;
				join?: JoinConfig | undefined;
			}) {
				if (join) {
					throw new DynamoDBAdapterError(
						"UNSUPPORTED_JOIN",
						"DynamoDB adapter does not support joins.",
					);
				}

				const offsetValue = offset ?? 0;
				const scanLimit = fetcher.resolveScanLimit({
					limit,
					offset: offsetValue,
					sortByDefined: Boolean(sortBy),
					requiresClientFilter: false,
				});
				const result = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where) ?? [],
					limit: scanLimit,
				});

				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: result.requiresClientFilter,
				});

				const sortedItems = applySort(filteredItems, {
					model,
					sortBy,
					getFieldName,
				});

				return sortedItems.slice(offsetValue, offsetValue + limit) as T[];
			},
			async count({
				model,
				where,
			}: {
				model: string;
				where?: Where[] | undefined;
			}) {
				const result = await fetcher.fetchCount({
					model,
					where: mapWhereFilters(where) ?? [],
				});
				if (!result.requiresClientFilter) {
					return result.count;
				}
				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: true,
				});
				return filteredItems.length;
			},
			async update<T>({
				model,
				where,
				update,
			}: {
				model: string;
				where: Where[];
				update: T;
			}) {
				const tableName = resolveModelTableName(model);
				const result = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where),
					limit: 1,
				});

				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: result.requiresClientFilter,
				});

				if (filteredItems.length === 0) {
					return null;
				}

				const primaryKeyName = getPrimaryKeyName(model);
				const key = buildPrimaryKey({
					item: filteredItems[0] as DynamoDBItem,
					keyField: primaryKeyName,
				});
				const updateExpression = buildUpdateExpression(
					update as Record<string, NativeAttributeValue>,
				);

				if (transactionState) {
					addTransactionOperation(transactionState, {
						kind: "update",
						tableName,
						key,
						updateExpression: updateExpression.updateExpression,
						expressionAttributeNames:
							updateExpression.expressionAttributeNames,
						expressionAttributeValues:
							updateExpression.expressionAttributeValues,
					});
					return applyUpdateData(
						filteredItems[0] as Record<string, unknown>,
						update as Record<string, unknown>,
					) as T;
				}

				const updateResult = await documentClient.send(
					new UpdateCommand({
						TableName: tableName,
						Key: key,
						UpdateExpression: updateExpression.updateExpression,
						ExpressionAttributeNames:
							updateExpression.expressionAttributeNames,
						ExpressionAttributeValues:
							updateExpression.expressionAttributeValues,
						ReturnValues: "ALL_NEW",
					}),
				);

				if (!updateResult.Attributes) {
					return null;
				}

				return updateResult.Attributes as T;
			},
			async updateMany({
				model,
				where,
				update,
			}: {
				model: string;
				where: Where[];
				update: Record<string, unknown>;
			}) {
				const tableName = resolveModelTableName(model);
				const result = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where),
				});

				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: result.requiresClientFilter,
				});

				if (filteredItems.length === 0) {
					return 0;
				}

				const primaryKeyName = getPrimaryKeyName(model);
				const updateExpression = buildUpdateExpression(
					update as Record<string, NativeAttributeValue>,
				);
				const state = { updated: 0 };

				for (const item of filteredItems) {
					const key = buildPrimaryKey({
						item: item as DynamoDBItem,
						keyField: primaryKeyName,
					});
					if (transactionState) {
						addTransactionOperation(transactionState, {
							kind: "update",
							tableName,
							key,
							updateExpression: updateExpression.updateExpression,
							expressionAttributeNames:
								updateExpression.expressionAttributeNames,
							expressionAttributeValues:
								updateExpression.expressionAttributeValues,
						});
					} else {
						await documentClient.send(
							new UpdateCommand({
								TableName: tableName,
								Key: key,
								UpdateExpression: updateExpression.updateExpression,
								ExpressionAttributeNames:
									updateExpression.expressionAttributeNames,
								ExpressionAttributeValues:
									updateExpression.expressionAttributeValues,
							}),
						);
					}
					state.updated += 1;
				}

				return state.updated;
			},
			async delete({
				model,
				where,
			}: {
				model: string;
				where: Where[];
			}) {
				const tableName = resolveModelTableName(model);
				const result = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where),
					limit: 1,
				});

				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: result.requiresClientFilter,
				});

				if (filteredItems.length === 0) {
					return;
				}

				const primaryKeyName = getPrimaryKeyName(model);
				const key = buildPrimaryKey({
					item: filteredItems[0] as DynamoDBItem,
					keyField: primaryKeyName,
				});
				if (transactionState) {
					addTransactionOperation(transactionState, {
						kind: "delete",
						tableName,
						key,
					});
					return;
				}
				await documentClient.send(
					new DeleteCommand({
						TableName: tableName,
						Key: key,
					}),
				);
			},
			async deleteMany({
				model,
				where,
			}: {
				model: string;
				where: Where[];
			}) {
				const tableName = resolveModelTableName(model);
				const result = await fetcher.fetchItems({
					model,
					where: mapWhereFilters(where),
				});

				const filteredItems = fetcher.applyClientFilter({
					items: result.items,
					where: mapWhereFilters(where),
					model,
					requiresClientFilter: result.requiresClientFilter,
				});

				if (filteredItems.length === 0) {
					return 0;
				}

				const primaryKeyName = getPrimaryKeyName(model);
				const state = { deleted: 0 };

				for (const item of filteredItems) {
					const key = buildPrimaryKey({
						item: item as DynamoDBItem,
						keyField: primaryKeyName,
					});
					if (transactionState) {
						addTransactionOperation(transactionState, {
							kind: "delete",
							tableName,
							key,
						});
					} else {
						await documentClient.send(
							new DeleteCommand({
								TableName: tableName,
								Key: key,
							}),
						);
					}
					state.deleted += 1;
				}

				return state.deleted;
			},
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
