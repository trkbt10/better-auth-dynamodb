/**
 * @file Count method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { buildKeyCondition } from "../dynamodb/expressions/build-key-condition";
import { buildFilterExpression } from "../dynamodb/expressions/build-filter-expression";
import { queryCount } from "../dynamodb/ops/query";
import { scanCount } from "../dynamodb/ops/scan";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import type { AdapterClientContainer } from "./client-container";

export type CountMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
};

export const createCountMethod = (
	client: AdapterClientContainer,
	options: CountMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, getFieldAttributes } =
		options;

	const resolveScanMaxPages = (): number => {
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
		const plan = buildQueryPlan({
			model,
			where,
			select: undefined,
			sortBy: undefined,
			limit: undefined,
			offset: undefined,
			join: undefined,
			getFieldName,
			getFieldAttributes,
			adapterConfig,
		});

		if (plan.execution.requiresClientFilter) {
			const executePlan = createQueryPlanExecutor({
				documentClient,
				adapterConfig,
				getFieldName,
				getDefaultModelName,
				getFieldAttributes,
			});
			const items = await executePlan(plan);
			return items.length;
		}

		if (plan.execution.baseStrategy.kind === "batch-get") {
			const executePlan = createQueryPlanExecutor({
				documentClient,
				adapterConfig,
				getFieldName,
				getDefaultModelName,
				getFieldAttributes,
			});
			const items = await executePlan(plan);
			return items.length;
		}

		const tableName = resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});

		const whereFilters = plan.base.where.map((entry) => ({
			field: entry.field,
			operator: entry.operator,
			value: entry.value,
			connector: entry.connector,
		}));

		if (plan.execution.baseStrategy.kind === "query") {
			const keyCondition = buildKeyCondition({
				model,
				where: whereFilters,
				getFieldName,
				getFieldAttributes,
				indexNameResolver: adapterConfig.indexNameResolver,
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
			return queryCount({
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
			});
		}

		const filter = buildFilterExpression({
			model,
			where: whereFilters,
			getFieldName,
		});
		const maxPages = resolveScanMaxPages();
		return scanCount({
			documentClient,
			tableName,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: filter.expressionAttributeNames,
			expressionAttributeValues: filter.expressionAttributeValues,
			maxPages,
		});
	};
};
