/**
 * @file Find-many method for the DynamoDB adapter.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { applySort } from "../dynamodb/query-utils/record-sort";
import type { AdapterMethodContext } from "./types";

type FindManyInput = {
	model: string;
	where?: Where[] | undefined;
	limit: number;
	sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
	offset?: number | undefined;
	join?: JoinConfig | undefined;
};

export const createFindManyExecutor = (context: AdapterMethodContext) => {
	const { fetchItems, applyClientFilter, resolveScanLimit, mapWhereFilters, getFieldName } =
		context;

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

export const createFindManyMethod = (context: AdapterMethodContext) => {
	const executeFindMany = createFindManyExecutor(context);

	return async <T>(input: FindManyInput) =>
		(await executeFindMany(input)) as T[];
};
