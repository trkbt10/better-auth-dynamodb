/**
 * @file Count method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { toDynamoWhere } from "../adapter/planner/normalize-where";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { buildKeyCondition } from "../dynamodb/expressions/build-key-condition";
import { buildFilterExpression } from "../dynamodb/expressions/build-filter-expression";
import { queryCount } from "../dynamodb/ops/query";
import { scanCount } from "../dynamodb/ops/scan";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import {
	hasTransactionItems,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { AdapterClientContainer } from "./client-container";
import { formatAdapterQueryPlan } from "../adapter/explain/format-query-plan";
import {
	createDynamoDBOperationStatsCollector,
	formatDynamoDBOperationStats,
} from "../dynamodb/ops/operation-stats";

export type CountMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createCountMethod = (
	client: AdapterClientContainer,
	options: CountMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;

		const resolveScanMaxPages = (): number => {
			if (adapterConfig.scanPageLimitMode === "unbounded") {
				return Number.POSITIVE_INFINITY;
			}
			if (adapterConfig.scanMaxPages === undefined) {
				throw new DynamoDBAdapterError(
					"MISSING_SCAN_LIMIT",
					"Count scan requires scanMaxPages.",
				);
			}
			return adapterConfig.scanMaxPages;
		};

	return async ({
		model,
		where,
	}: {
		model: string;
		where?: Where[] | undefined;
	}) => {
		const resolveOperationStats = () => {
			if (!adapterConfig.explainQueryPlans) {
				return undefined;
			}
			return createDynamoDBOperationStatsCollector();
		};
		const operationStats = resolveOperationStats();
		const finalize = (value: number): number => {
			if (adapterConfig.explainQueryPlans && operationStats) {
				console.log(formatDynamoDBOperationStats(operationStats.snapshot()));
			}
			return value;
		};

			const plan = buildQueryPlan({
				model,
				where,
				select: undefined,
			sortBy: undefined,
			limit: undefined,
			offset: undefined,
			join: undefined,
			getFieldName,
				adapterConfig,
			});
			if (adapterConfig.explainQueryPlans) {
				console.log(
					formatAdapterQueryPlan({
						plan,
						adapterConfig,
						getDefaultModelName,
					}),
				);
			}

		const tableName = resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
		// DynamoDB can only count stored rows. Rows the transaction has written
		// to have to be counted from its overlay, i.e. through the executor.
		const countsBufferedRows = (): boolean => {
			if (!transactionState) {
				return false;
			}
			return hasTransactionItems(transactionState, tableName);
		};
		const requiresExecutor = (): boolean => {
			if (plan.execution.requiresClientFilter) {
				return true;
			}
			if (plan.execution.baseStrategy.kind === "batch-get") {
				return true;
			}
			return countsBufferedRows();
		};

		if (requiresExecutor()) {
			const executePlan = createQueryPlanExecutor({
				documentClient,
				adapterConfig,
				getFieldName,
				getDefaultModelName,
				transactionState,
			});
			const items = await executePlan(plan, { operationStats });
			return finalize(items.length);
		}

		const whereFilters = toDynamoWhere(plan.base.where);

		if (plan.execution.baseStrategy.kind === "query") {
			const keyCondition = buildKeyCondition({
				model,
				where: whereFilters,
				getFieldName,
				indexNameResolver: adapterConfig.indexNameResolver,
				indexKeySchemaResolver: adapterConfig.indexKeySchemaResolver,
			});
			if (!keyCondition) {
				throw new DynamoDBAdapterError(
					"MISSING_KEY_CONDITION",
					"Count query requires a key condition.",
				);
			}
			const filter = buildFilterExpression({
				model,
				where: keyCondition.remainingWhere,
				getFieldName,
			});
				const count = await queryCount({
					documentClient,
					tableName,
					indexName: keyCondition.indexName,
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
					explainDynamoOperations: adapterConfig.explainDynamoOperations,
					operationStats,
				});
				return finalize(count);
			}

		const filter = buildFilterExpression({
			model,
			where: whereFilters,
			getFieldName,
		});
		const maxPages = resolveScanMaxPages();
			const count = await scanCount({
				documentClient,
				tableName,
				filterExpression: filter.filterExpression,
				expressionAttributeNames: filter.expressionAttributeNames,
				expressionAttributeValues: filter.expressionAttributeValues,
				maxPages,
				explainDynamoOperations: adapterConfig.explainDynamoOperations,
				operationStats,
			});
			return finalize(count);
		};
	};
