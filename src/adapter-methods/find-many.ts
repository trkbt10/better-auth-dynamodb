/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter-config";
import { applyClientFilter } from "../dynamodb/query-utils/apply-client-filter";
import { createFetchItems } from "../dynamodb/query-utils/create-fetch-items";
import { applySort } from "../dynamodb/query-utils/record-sort";
import { resolveScanLimit } from "../dynamodb/query-utils/resolve-scan-limit";
import type { AdapterClientContainer } from "./client-container";
import { mapWhereFilters } from "./map-where-filters";

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
	const fetchItems = createFetchItems({
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
		if (join) {
			throw new DynamoDBAdapterError(
				"UNSUPPORTED_JOIN",
				"DynamoDB adapter does not support joins.",
			);
		}

		const offsetValue = offset ?? 0;
		const mappedWhere = mapWhereFilters(where);
		const scanLimit = resolveScanLimit({
			limit,
			offset: offsetValue,
			sortByDefined: Boolean(sortBy),
			requiresClientFilter: false,
		});
		const result = await fetchItems({
			model,
			where: mappedWhere ?? [],
			limit: scanLimit,
		});

		const filteredItems = applyClientFilter({
			items: result.items,
			where: mappedWhere,
			model,
			getFieldName,
			requiresClientFilter: result.requiresClientFilter,
		});

		const sortedItems = applySort(filteredItems, {
			model,
			sortBy,
			getFieldName,
		});

		return sortedItems.slice(offsetValue, offsetValue + limit);
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
