/**
 * @file Fetch items for DynamoDB adapter.
 */
import type { DynamoDBWhere } from "../types";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter-config";
import { buildFilterExpression } from "./build-filter-expression";
import { resolveTableName } from "./resolve-table-name";
import { queryItems } from "./query-command";
import { scanItems } from "./scan-command";
import type { DynamoDBItem } from "./where-evaluator";
import { resolveFetchLimit } from "./resolve-fetch-limit";
import { buildKeyCondition } from "./build-key-condition";

export const createFetchItems = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
}) => {
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName: props.getDefaultModelName,
			config: props.adapterConfig,
		});

	const buildFilter = (model: string, where: DynamoDBWhere[] | undefined) =>
		buildFilterExpression({
			model,
			where,
			getFieldName: props.getFieldName,
		});

	return async (input: {
		model: string;
		where: DynamoDBWhere[] | undefined;
		limit?: number | undefined;
	}): Promise<{ items: DynamoDBItem[]; requiresClientFilter: boolean }> => {
		const tableName = resolveModelTableName(input.model);
		const keyCondition = buildKeyCondition({
			model: input.model,
			where: input.where,
			getFieldName: props.getFieldName,
			getFieldAttributes: props.getFieldAttributes,
			indexNameResolver: props.adapterConfig.indexNameResolver,
		});
		if (keyCondition) {
			const filter = buildFilter(input.model, keyCondition.remainingWhere);
			const adjustedLimit = resolveFetchLimit({
				limit: input.limit,
				requiresClientFilter: filter.requiresClientFilter,
			});
			const items = (await queryItems({
				documentClient: props.documentClient,
				tableName,
				indexName: keyCondition.indexName,
				keyConditionExpression: keyCondition.keyConditionExpression,
				filterExpression: filter.filterExpression,
				expressionAttributeNames: {
					...keyCondition.expressionAttributeNames,
					...filter.expressionAttributeNames,
				},
				expressionAttributeValues: {
					...keyCondition.expressionAttributeValues,
					...filter.expressionAttributeValues,
				},
				limit: adjustedLimit,
			})) as DynamoDBItem[];
			return { items, requiresClientFilter: filter.requiresClientFilter };
		}

		const filter = buildFilter(input.model, input.where);
		const adjustedLimit = resolveFetchLimit({
			limit: input.limit,
			requiresClientFilter: filter.requiresClientFilter,
		});
		const items = (await scanItems({
			documentClient: props.documentClient,
			tableName,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: filter.expressionAttributeNames,
			expressionAttributeValues: filter.expressionAttributeValues,
			limit: adjustedLimit,
		})) as DynamoDBItem[];
		return { items, requiresClientFilter: filter.requiresClientFilter };
	};
};
