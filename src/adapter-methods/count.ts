/**
 * @file Count method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter-config";
import { applyClientFilter } from "../dynamodb/query-utils/apply-client-filter";
import { createFetchCount } from "../dynamodb/query-utils/create-fetch-count";
import type { AdapterClientContainer } from "./client-container";
import { mapWhereFilters } from "./map-where-filters";

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
	const fetchCount = createFetchCount({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
	});

	return async ({
		model,
		where,
	}: {
		model: string;
		where?: Where[] | undefined;
	}) => {
		const result = await fetchCount({
			model,
			where: mapWhereFilters(where) ?? [],
		});
		if (!result.requiresClientFilter) {
			return result.count;
		}
		const filteredItems = applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			getFieldName,
			requiresClientFilter: true,
		});
		return filteredItems.length;
	};
};
