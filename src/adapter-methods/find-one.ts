/**
 * @file Find-one method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { FindManyOptions } from "./find-many";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import type { AdapterClientContainer } from "./client-container";
import type { PrimaryKeyBatchLoader } from "../adapter/batching/primary-key-batch-loader";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import {
	formatAdapterQueryPlan,
} from "../adapter/explain/format-query-plan";
import {
	createDynamoDBOperationStatsCollector,
	formatDynamoDBOperationStats,
} from "../dynamodb/ops/operation-stats";
import type { DynamoDBTransactionState } from "../dynamodb/ops/transaction";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { searchTransactionBuffer } from "./transaction-buffer-search";

type FindOneOptions = FindManyOptions & {
	primaryKeyLoader?: PrimaryKeyBatchLoader | undefined;
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createFindOneMethod = (
	client: AdapterClientContainer,
	options: FindOneOptions,
) => {
	const executePlan = createQueryPlanExecutor({
		documentClient: client.documentClient,
		adapterConfig: options.adapterConfig,
		getFieldName: options.getFieldName,
		getDefaultModelName: options.getDefaultModelName,
	});

	return async <T>({
		model,
		where,
		select,
		join,
	}: {
		model: string;
		where: Where[];
		select?: string[] | undefined;
		join?: JoinConfig | undefined;
	}) => {
		if (options.transactionState) {
			const tableName = resolveTableName({
				model,
				getDefaultModelName: options.getDefaultModelName,
				config: options.adapterConfig,
			});
			const bufferResult = searchTransactionBuffer({
				transactionState: options.transactionState,
				tableName,
				where,
			});
			if (bufferResult.found) {
				return bufferResult.item as T;
			}
		}

		if (options.primaryKeyLoader) {
			if (join === undefined) {
				if (select === undefined) {
					if (where.length === 1) {
						const condition = where[0];
						const operator = condition.operator ?? "eq";
						const connector = (condition.connector ?? "AND").toUpperCase();
						const idFieldName = options.getFieldName({ model, field: "id" });
						if (operator === "eq") {
							if (connector === "AND") {
								if (condition.field === idFieldName) {
									const value = condition.value as NativeAttributeValue | undefined;
									if (value === undefined) {
										return null;
									}
									const item = await options.primaryKeyLoader.load({ model, key: value });
									return (item as T | null) ?? null;
								}
							}
						}
					}
				}
			}
		}

		const plan = buildQueryPlan({
			model,
			where,
			select,
			sortBy: undefined,
			limit: 1,
			offset: 0,
			join,
			getFieldName: options.getFieldName,
			adapterConfig: options.adapterConfig,
		});

		const resolveOperationStats = () => {
			if (!options.adapterConfig.explainQueryPlans) {
				return undefined;
			}
			return createDynamoDBOperationStatsCollector();
		};
		const operationStats = resolveOperationStats();
		if (options.adapterConfig.explainQueryPlans) {
			console.log(
				formatAdapterQueryPlan({
					plan,
					adapterConfig: options.adapterConfig,
					getDefaultModelName: options.getDefaultModelName,
				}),
			);
		}
		const filteredItems = await executePlan(plan, { operationStats });
		if (options.adapterConfig.explainQueryPlans && operationStats) {
			console.log(formatDynamoDBOperationStats(operationStats.snapshot()));
		}

		if (filteredItems.length === 0) {
			return null;
		}

		return filteredItems[0] as T;
	};
};
