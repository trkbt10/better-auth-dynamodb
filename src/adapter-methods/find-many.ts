/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { applySort } from "../dynamodb/sorting/record-sort";
import type { AdapterMethodContext } from "./types";

export const createFindManyMethod = (context: AdapterMethodContext) => {
	const { fetcher, mapWhereFilters, getFieldName } = context;

	return async <T>({
		model,
		where,
		limit,
		sortBy,
		offset,
		join,
	}: {
		model: string;
		where?: Where[] | undefined;
		limit: number;
		sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
		offset?: number | undefined;
		join?: JoinConfig | undefined;
	}) => {
		if (join) {
			throw new DynamoDBAdapterError(
				"UNSUPPORTED_JOIN",
				"DynamoDB adapter does not support joins.",
			);
		}

		const offsetValue = offset ?? 0;
		const scanLimit = fetcher.resolveScanLimit({
			limit,
			offset: offsetValue,
			sortByDefined: Boolean(sortBy),
			requiresClientFilter: false,
		});
		const result = await fetcher.fetchItems({
			model,
			where: mapWhereFilters(where) ?? [],
			limit: scanLimit,
		});

		const filteredItems = fetcher.applyClientFilter({
			items: result.items,
			where: mapWhereFilters(where),
			model,
			requiresClientFilter: result.requiresClientFilter,
		});

		const sortedItems = applySort(filteredItems, {
			model,
			sortBy,
			getFieldName,
		});

		return sortedItems.slice(offsetValue, offsetValue + limit) as T[];
	};
};
