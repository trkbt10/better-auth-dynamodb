/**
 * @file Find-one method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { FindManyOptions } from "./find-many";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import type { AdapterClientContainer } from "./client-container";

type FindOneOptions = FindManyOptions;

export const createFindOneMethod = (
	client: AdapterClientContainer,
	options: FindOneOptions,
) => {
	const executePlan = createQueryPlanExecutor({
		documentClient: client.documentClient,
		adapterConfig: options.adapterConfig,
		getFieldName: options.getFieldName,
		getDefaultModelName: options.getDefaultModelName,
		getFieldAttributes: options.getFieldAttributes,
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
		const plan = buildQueryPlan({
			model,
			where,
			select,
			sortBy: undefined,
			limit: 1,
			offset: 0,
			join,
			getFieldName: options.getFieldName,
			getFieldAttributes: options.getFieldAttributes,
			adapterConfig: options.adapterConfig,
		});
		const filteredItems = await executePlan(plan);

		if (filteredItems.length === 0) {
			return null;
		}

		return filteredItems[0] as T;
	};
};
