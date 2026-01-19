/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import type { AdapterClientContainer } from "./client-container";
import { formatAdapterQueryPlan } from "../adapter/explain/format-query-plan";

type FindManyInput = {
	model: string;
	where?: Where[] | undefined;
	limit: number;
	sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
	offset?: number | undefined;
	join?: JoinConfig | undefined;
};

export type FindManyOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
};

export const createFindManyExecutor = (
	client: AdapterClientContainer,
	options: FindManyOptions,
) => {
	const { documentClient } = client;
	const {
		adapterConfig,
		getFieldName,
		getDefaultModelName,
	} = options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
	});

	return async ({
		model,
		where,
		limit,
		sortBy,
		offset,
		join,
		}: FindManyInput) => {
			const plan = buildQueryPlan({
				model,
				where,
				select: undefined,
			sortBy,
			limit,
			offset,
			join,
			getFieldName,
				adapterConfig,
			});

			if (adapterConfig.explainQueryPlans) {
				console.log(formatAdapterQueryPlan(plan));
			}

			return executePlan(plan);
		};
	};

export const createFindManyMethod = (
	client: AdapterClientContainer,
	options: FindManyOptions,
) => {
	const executeFindMany = createFindManyExecutor(client, options);

	return async <T>(input: FindManyInput) =>
		(await executeFindMany(input)) as T[];
};
