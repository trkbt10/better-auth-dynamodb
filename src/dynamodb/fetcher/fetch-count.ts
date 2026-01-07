/**
 * @file Fetch count for DynamoDB adapter.
 */
import type { DynamoDBWhere } from "../types";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter-config";
import { buildFilterExpression } from "../expressions/filter-expression";
import { resolveTableName } from "../keys/table-name";
import { queryCount } from "../operations/query";
import { scanCount, scanItems } from "../operations/scan";
import type { DynamoDBItem } from "../where/where-evaluator";
import { buildKeyCondition } from "./key-condition";

export const createFetchCount = (props: {
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
	}): Promise<{ count: number; requiresClientFilter: boolean; items: DynamoDBItem[] }> => {
		const tableName = resolveModelTableName(input.model);
		const keyCondition = buildKeyCondition({
			model: input.model,
			where: input.where,
			getFieldName: props.getFieldName,
		});
		if (keyCondition) {
			const count = await queryCount({
				documentClient: props.documentClient,
				tableName,
				keyConditionExpression: keyCondition.keyConditionExpression,
				filterExpression: undefined,
				expressionAttributeNames: keyCondition.expressionAttributeNames,
				expressionAttributeValues: keyCondition.expressionAttributeValues,
			});
			return { count, requiresClientFilter: false, items: [] };
		}

		const filter = buildFilter(input.model, input.where);
		if (!filter.requiresClientFilter) {
			const count = await scanCount({
				documentClient: props.documentClient,
				tableName,
				filterExpression: filter.filterExpression,
				expressionAttributeNames: filter.expressionAttributeNames,
				expressionAttributeValues: filter.expressionAttributeValues,
			});
			return { count, requiresClientFilter: false, items: [] };
		}

		const items = (await scanItems({
			documentClient: props.documentClient,
			tableName,
			filterExpression: filter.filterExpression,
			expressionAttributeNames: filter.expressionAttributeNames,
			expressionAttributeValues: filter.expressionAttributeValues,
		})) as DynamoDBItem[];
		return { count: 0, requiresClientFilter: true, items };
	};
};
