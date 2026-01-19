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
import { formatAdapterQueryPlan } from "../adapter/explain/format-query-plan";

type FindOneOptions = FindManyOptions & {
	primaryKeyLoader?: PrimaryKeyBatchLoader | undefined;
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
									if (options.adapterConfig.explainQueryPlans) {
										console.log(`[QueryPlan] model=${model}\n  where:\n    AND ${idFieldName} eq ${JSON.stringify(value)}\n  base: batch-get(pk)\n  joins: (none)`);
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
		if (options.adapterConfig.explainQueryPlans) {
			console.log(formatAdapterQueryPlan(plan));
		}
		const filteredItems = await executePlan(plan);

		if (filteredItems.length === 0) {
			return null;
		}

		return filteredItems[0] as T;
	};
};
