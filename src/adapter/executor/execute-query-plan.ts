/**
 * @file Execute adapter query plans.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBAdapterConfig } from "../../adapter";
import type { AdapterQueryPlan, NormalizedWhere } from "../query-plan";
import type { DynamoDBWhere } from "../../dynamodb/types";
import type { DynamoDBItem } from "./where-evaluator";
import { applyClientFilter } from "./apply-client-filter";
import { applySort } from "./apply-sort";
import { applySelect } from "./apply-select";
import { executeJoin } from "./execute-join";
import {
	buildKeyCondition,
	selectQueryFilterWhere,
} from "../../dynamodb/expressions/build-key-condition";
import { buildFilterExpression } from "../../dynamodb/expressions/build-filter-expression";
import { queryItems } from "../../dynamodb/ops/query";
import { scanItems } from "../../dynamodb/ops/scan";
import { batchGetItems } from "../../dynamodb/ops/batch-get";
import { resolveTableName } from "../../dynamodb/mapping/resolve-table-name";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";
import type { DynamoDBOperationStatsCollector } from "../../dynamodb/ops/operation-stats";
import {
	applyTransactionOverlay,
	countTransactionItems,
	type DynamoDBTransactionState,
} from "../../dynamodb/ops/transaction";
import { applyWhereFilters } from "./where-evaluator";
import { toDynamoWhere } from "../planner/normalize-where";

export type AdapterExecutionContext = {
	operationStats?: DynamoDBOperationStatsCollector | undefined;
};

const resolveRequiresClientFilter = (props: {
	strategy: AdapterQueryPlan["execution"]["baseStrategy"];
	requiresClientFilter: boolean;
}): boolean => {
	if (props.strategy.kind === "batch-get") {
		return true;
	}
	return props.requiresClientFilter;
};

const resolveScanIndexForward = (props: {
	serverSort?: AdapterQueryPlan["execution"]["serverSort"] | undefined;
}): boolean | undefined => {
	if (!props.serverSort) {
		return undefined;
	}
	return props.serverSort.direction === "asc";
};

const resolveIndexName = (props: {
	strategy: AdapterQueryPlan["execution"]["baseStrategy"];
	keyConditionIndex?: string | undefined;
}): string | undefined => {
	if (props.strategy.kind !== "query") {
		return props.keyConditionIndex;
	}
	if (props.strategy.key === "gsi") {
		return props.strategy.indexName;
	}
	return props.keyConditionIndex;
};

const resolveSortedItems = <T extends Record<string, unknown>>(props: {
	items: T[];
	serverSort?: AdapterQueryPlan["execution"]["serverSort"] | undefined;
	sort?: AdapterQueryPlan["base"]["sort"] | undefined;
}): T[] => {
	if (props.serverSort) {
		return props.items;
	}
	return applySort(props.items, { sortBy: props.sort });
};

const resolveScanMaxPages = (props: {
	adapterConfig: DynamoDBAdapterConfig;
}): number => {
	if (props.adapterConfig.scanPageLimitMode === "unbounded") {
		return Number.POSITIVE_INFINITY;
	}
	if (props.adapterConfig.scanMaxPages === undefined) {
		throw new DynamoDBAdapterError(
			"MISSING_SCAN_LIMIT",
			"Scan execution requires scanMaxPages.",
		);
	}
	return props.adapterConfig.scanMaxPages;
};

// A value listed twice in an IN list selects the same rows once. BatchGetItem
// rejects duplicate keys, and one query per value would return rows twice.
const uniqueValues = (values: NativeAttributeValue[]): NativeAttributeValue[] =>
	Array.from(new Set(values));

const resolvePrimaryKeyValues = (props: {
	where: NormalizedWhere[];
	primaryKeyName: string;
}): NativeAttributeValue[] => {
	const entry = props.where.find(
		(condition) => condition.field === props.primaryKeyName && condition.operator === "in",
	);
	if (!entry) {
		return [];
	}
	if (!Array.isArray(entry.value)) {
		return [];
	}
	return uniqueValues(entry.value as NativeAttributeValue[]);
};

const fetchBaseItems = async (props: {
	plan: AdapterQueryPlan;
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	operationStats?: DynamoDBOperationStatsCollector | undefined;
}): Promise<DynamoDBItem[]> => {
	const where = toDynamoWhere(props.plan.base.where);
	const tableName = resolveTableName({
		model: props.plan.base.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});

	const strategy = props.plan.execution.baseStrategy;
	if (strategy.kind === "batch-get") {
		const primaryKeyName = props.getFieldName({
			model: props.plan.base.model,
			field: "id",
		});
		const keys = resolvePrimaryKeyValues({
			where: props.plan.base.where,
			primaryKeyName,
		});
		if (keys.length === 0) {
			return [];
		}
			return batchGetItems({
				documentClient: props.documentClient,
				tableName,
				keyField: primaryKeyName,
				keys,
				explainDynamoOperations: props.adapterConfig.explainDynamoOperations,
				operationStats: props.operationStats,
			});
		}

	if (strategy.kind === "multi-query") {
		const inEntry = props.plan.base.where.find(
			(entry) => entry.field === strategy.field && entry.operator === "in",
		);
		if (!inEntry) {
			return [];
		}
		if (!Array.isArray(inEntry.value)) {
			return [];
		}
		const values = uniqueValues(inEntry.value as NativeAttributeValue[]);
		const perQueryLimit = props.plan.execution.fetchLimit;
		const baseModel = props.plan.base.model;
		const results = await Promise.all(
			values.map(async (value) => {
				const queryWhere: DynamoDBWhere[] = where.map((entry) => {
					if (entry.field === strategy.field && entry.operator === "in") {
						return {
							...entry,
							operator: "eq",
							value,
						} as DynamoDBWhere;
					}
					return entry;
				});
				const keyCondition = buildKeyCondition({
					model: baseModel,
					where: queryWhere,
					getFieldName: props.getFieldName,
					indexNameResolver: props.adapterConfig.indexNameResolver,
					indexKeySchemaResolver: props.adapterConfig.indexKeySchemaResolver,
				});
				if (!keyCondition) {
					return [];
				}
				const filter = buildFilterExpression({
					model: baseModel,
					where: selectQueryFilterWhere({
						model: baseModel,
						where: keyCondition.remainingWhere,
						keyAttributes: keyCondition.keyAttributes,
						getFieldName: props.getFieldName,
					}),
					getFieldName: props.getFieldName,
				});
					return (await queryItems({
						documentClient: props.documentClient,
						tableName,
						indexName: keyCondition.indexName ?? strategy.indexName,
						keyConditionExpression: keyCondition.keyConditionExpression,
					filterExpression: filter.filterExpression,
					expressionAttributeNames: {
						...keyCondition.expressionAttributeNames,
						...filter.expressionAttributeNames,
					},
						expressionAttributeValues: {
							...keyCondition.expressionAttributeValues,
							...filter.expressionAttributeValues,
						},
						limit: perQueryLimit,
						explainDynamoOperations: props.adapterConfig.explainDynamoOperations,
						operationStats: props.operationStats,
					})) as DynamoDBItem[];
				}),
			);
			return results.flat();
		}

	if (strategy.kind === "query") {
		const keyCondition = buildKeyCondition({
			model: props.plan.base.model,
			where,
			getFieldName: props.getFieldName,
			indexNameResolver: props.adapterConfig.indexNameResolver,
			indexKeySchemaResolver: props.adapterConfig.indexKeySchemaResolver,
		});
		if (!keyCondition) {
			throw new DynamoDBAdapterError(
				"MISSING_KEY_CONDITION",
				"Query strategy requires a key condition.",
			);
		}
		const filter = buildFilterExpression({
			model: props.plan.base.model,
			where: selectQueryFilterWhere({
				model: props.plan.base.model,
				where: keyCondition.remainingWhere,
				keyAttributes: keyCondition.keyAttributes,
				getFieldName: props.getFieldName,
			}),
			getFieldName: props.getFieldName,
		});
		const indexName = resolveIndexName({
			strategy,
			keyConditionIndex: keyCondition.indexName,
		});
		const scanIndexForward = resolveScanIndexForward({
			serverSort: props.plan.execution.serverSort,
		});
			return (await queryItems({
				documentClient: props.documentClient,
				tableName,
				indexName,
				keyConditionExpression: keyCondition.keyConditionExpression,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: {
				...keyCondition.expressionAttributeNames,
				...filter.expressionAttributeNames,
			},
			expressionAttributeValues: {
				...keyCondition.expressionAttributeValues,
				...filter.expressionAttributeValues,
				},
				limit: props.plan.execution.fetchLimit,
				scanIndexForward,
				explainDynamoOperations: props.adapterConfig.explainDynamoOperations,
				operationStats: props.operationStats,
			})) as DynamoDBItem[];
		}

	const filter = buildFilterExpression({
		model: props.plan.base.model,
		where,
		getFieldName: props.getFieldName,
	});
	const maxPages = resolveScanMaxPages({ adapterConfig: props.adapterConfig });
		return (await scanItems({
			documentClient: props.documentClient,
			tableName,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: filter.expressionAttributeNames,
			expressionAttributeValues: filter.expressionAttributeValues,
			limit: props.plan.execution.fetchLimit,
			maxPages,
			explainDynamoOperations: props.adapterConfig.explainDynamoOperations,
			operationStats: props.operationStats,
		})) as DynamoDBItem[];
	};

const applyOffsetLimit = <T>(props: {
	items: T[];
	offset?: number | undefined;
	limit?: number | undefined;
}): T[] => {
	const offset = props.offset ?? 0;
	if (props.limit === undefined) {
		return props.items.slice(offset);
	}
	return props.items.slice(offset, offset + props.limit);
};

// Rows the transaction has written to are answered from its overlay: each of
// them may drop out of the stored result, so that many more stored rows are
// read, and the order is established again after the overlay is applied.
const resolveOverlayTable = (props: {
	plan: AdapterQueryPlan;
	transactionState: DynamoDBTransactionState | undefined;
	adapterConfig: DynamoDBAdapterConfig;
	getDefaultModelName: (model: string) => string;
}): { tableName: string; bufferedRows: number } | undefined => {
	if (!props.transactionState) {
		return undefined;
	}
	const tableName = resolveTableName({
		model: props.plan.base.model,
		getDefaultModelName: props.getDefaultModelName,
		config: props.adapterConfig,
	});
	const bufferedRows = countTransactionItems(props.transactionState, tableName);
	if (bufferedRows === 0) {
		return undefined;
	}
	return { tableName, bufferedRows };
};

const withOverlayFetchLimit = (
	plan: AdapterQueryPlan,
	bufferedRows: number,
): AdapterQueryPlan => {
	if (plan.execution.fetchLimit === undefined) {
		return plan;
	}
	return {
		...plan,
		execution: {
			...plan.execution,
			fetchLimit: plan.execution.fetchLimit + bufferedRows,
		},
	};
};

export const createQueryPlanExecutor = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: DynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	transactionState?: DynamoDBTransactionState | undefined;
}) => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_EXECUTOR_INPUT",
			"createQueryPlanExecutor requires explicit props.",
		);
	}
	const resolveOverlaidItems = (
		plan: AdapterQueryPlan,
		overlay: { tableName: string } | undefined,
		items: DynamoDBItem[],
	): DynamoDBItem[] => {
		if (!props.transactionState || overlay === undefined) {
			return items;
		}
		return applyTransactionOverlay(props.transactionState, {
			tableName: overlay.tableName,
			keyField: props.getFieldName({ model: plan.base.model, field: "id" }),
			items,
			matches: (item) =>
				applyWhereFilters({ items: [item], where: plan.base.where }).length === 1,
		});
	};

	return async (
		requestedPlan: AdapterQueryPlan,
		context?: AdapterExecutionContext | undefined,
	): Promise<DynamoDBItem[]> => {
		const overlay = resolveOverlayTable({
			plan: requestedPlan,
			transactionState: props.transactionState,
			adapterConfig: props.adapterConfig,
			getDefaultModelName: props.getDefaultModelName,
		});
		const resolvePlan = (): AdapterQueryPlan => {
			if (overlay === undefined) {
				return requestedPlan;
			}
			return withOverlayFetchLimit(requestedPlan, overlay.bufferedRows);
		};
		const plan = resolvePlan();
		const baseItems = await fetchBaseItems({
			plan,
			documentClient: props.documentClient,
			adapterConfig: props.adapterConfig,
			getFieldName: props.getFieldName,
			getDefaultModelName: props.getDefaultModelName,
			operationStats: context?.operationStats,
		});

		const requiresClientFilter = resolveRequiresClientFilter({
			strategy: plan.execution.baseStrategy,
			requiresClientFilter: plan.execution.requiresClientFilter,
		});
		const filteredItems = resolveOverlaidItems(
			plan,
			overlay,
			applyClientFilter({
				items: baseItems,
				where: plan.base.where,
				requiresClientFilter,
			}),
		);

		const resolveServerSort = () => {
			if (overlay !== undefined) {
				return undefined;
			}
			return plan.execution.serverSort;
		};
		const sortedItems = resolveSortedItems({
			items: filteredItems,
			serverSort: resolveServerSort(),
			sort: plan.base.sort,
		});

		const limitedItems = applyOffsetLimit({
			items: sortedItems,
			offset: plan.base.offset,
			limit: plan.base.limit,
		});

		const joinedItems = plan.joins.reduce<Promise<DynamoDBItem[]>>(
			async (accPromise, joinPlan) => {
				const items = await accPromise;
				return executeJoin({
					baseItems: items,
					join: joinPlan,
					documentClient: props.documentClient,
					adapterConfig: props.adapterConfig,
					getFieldName: props.getFieldName,
					getDefaultModelName: props.getDefaultModelName,
					operationStats: context?.operationStats,
					transactionState: props.transactionState,
				});
			},
			Promise.resolve(limitedItems),
		);

		const itemsWithJoins = await joinedItems;
		const joinKeys = plan.joins.map((joinPlan) => joinPlan.modelKey);
		const selectedItems = applySelect({
			items: itemsWithJoins,
			model: plan.base.model,
			select: plan.base.select,
			joinKeys,
			getFieldName: props.getFieldName,
		});

		return selectedItems as DynamoDBItem[];
	};
};
