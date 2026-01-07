/**
 * @file DynamoDB adapter fetcher.
 */
import type { DynamoDBWhere } from "../types";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter-config";
import { type DynamoDBItem } from "../where/where-evaluator";
import { applyClientFilter } from "./client-filter";
import { createFetchCount } from "./fetch-count";
import { createFetchItems } from "./fetch-items";
import { resolveScanLimit } from "./scan-limit";

export type AdapterFetchResult = {
	items: DynamoDBItem[];
	requiresClientFilter: boolean;
};

export type AdapterCountResult = {
	count: number;
	requiresClientFilter: boolean;
	items: DynamoDBItem[];
};

export type AdapterFetcher = {
	fetchItems: (props: {
		model: string;
		where: DynamoDBWhere[] | undefined;
		limit?: number | undefined;
	}) => Promise<AdapterFetchResult>;
	fetchCount: (props: {
		model: string;
		where: DynamoDBWhere[] | undefined;
	}) => Promise<AdapterCountResult>;
	applyClientFilter: (props: {
		items: DynamoDBItem[];
		where: DynamoDBWhere[] | undefined;
		model: string;
		requiresClientFilter: boolean;
	}) => DynamoDBItem[];
	resolveScanLimit: (props: {
		limit: number;
		offset: number;
		sortByDefined: boolean;
		requiresClientFilter: boolean;
	}) => number | undefined;
};

export const createAdapterFetcher = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
}): AdapterFetcher => {
	const fetchItems = createFetchItems(props);
	const fetchCount = createFetchCount(props);

	const applyClientFilterForFetch = (input: {
		items: DynamoDBItem[];
		where: DynamoDBWhere[] | undefined;
		model: string;
		requiresClientFilter: boolean;
	}): DynamoDBItem[] =>
		applyClientFilter({
			items: input.items,
			where: input.where,
			model: input.model,
			getFieldName: props.getFieldName,
			requiresClientFilter: input.requiresClientFilter,
		});

	return {
		fetchItems,
		fetchCount,
		applyClientFilter: applyClientFilterForFetch,
		resolveScanLimit,
	};
};
