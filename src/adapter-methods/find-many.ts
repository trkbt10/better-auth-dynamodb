/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import type { AdapterClientContainer } from "./client-container";

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
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
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
		getFieldAttributes,
	} = options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
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
			getFieldAttributes,
			adapterConfig,
		});

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
