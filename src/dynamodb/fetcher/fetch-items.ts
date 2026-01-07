/**
 * @file Fetch items for DynamoDB adapter.
 */
import type { DynamoDBWhere } from "../types";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter-config";
import { buildFilterExpression } from "../expressions/filter-expression";
import { resolveTableName } from "../keys/table-name";
import { queryItems } from "../operations/query";
import { scanItems } from "../operations/scan";
import type { DynamoDBItem } from "../where/where-evaluator";
import { resolveFetchLimit } from "./fetch-limit";
import { buildKeyCondition } from "./key-condition";

export const createFetchItems = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
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
		});
		if (keyCondition) {
			const items = (await queryItems({
				documentClient: props.documentClient,
				tableName,
				keyConditionExpression: keyCondition.keyConditionExpression,
				filterExpression: undefined,
				expressionAttributeNames: keyCondition.expressionAttributeNames,
				expressionAttributeValues: keyCondition.expressionAttributeValues,
				limit: input.limit,
			})) as DynamoDBItem[];
			return { items, requiresClientFilter: false };
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
