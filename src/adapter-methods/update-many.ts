/**
 * @file Update-many method for the DynamoDB adapter.
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter-config";
import { applyClientFilter } from "../dynamodb/query-utils/apply-client-filter";
import { buildUpdateExpression } from "../dynamodb/query-utils/build-update-expression";
import { buildPrimaryKey } from "../dynamodb/query-utils/build-primary-key";
import { createFetchItems } from "../dynamodb/query-utils/create-fetch-items";
import { resolveTableName } from "../dynamodb/query-utils/resolve-table-name";
import {
	addTransactionOperation,
	type DynamoDBTransactionState,
} from "../dynamodb/query-utils/transaction";
import type { DynamoDBItem } from "../dynamodb/query-utils/where-evaluator";
import type { AdapterClientContainer } from "./client-container";
import { mapWhereFilters } from "./map-where-filters";

type UpdateExecutionInput = {
	model: string;
	where: Where[];
	update: Record<string, unknown>;
	limit?: number | undefined;
	returnUpdatedItems: boolean;
};

type UpdateExecutionResult = {
	updatedCount: number;
	updatedItems: Record<string, unknown>[];
};

const applyUpdateData = <T extends Record<string, unknown>>(
	item: T,
	update: Record<string, unknown>,
): T => {
	const entries = Object.entries(update).filter(
		([, value]) => value !== undefined,
	);
	const updates = entries.reduce<Record<string, unknown>>((acc, [key, value]) => {
		acc[key] = value;
		return acc;
	}, {});
	return { ...item, ...updates };
};

const buildReturnValues = (returnUpdatedItems: boolean) => {
	if (returnUpdatedItems) {
		return { ReturnValues: "ALL_NEW" as const };
	}
	return {};
};

export type UpdateMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	getFieldAttributes: (args: { model: string; field: string }) => {
		index?: boolean | undefined;
	};
	transactionState?: DynamoDBTransactionState | undefined;
};

export const createUpdateExecutor = (
	client: AdapterClientContainer,
	options: UpdateMethodOptions,
) => {
	const { documentClient } = client;
	const {
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
		transactionState,
	} = options;
	const fetchItems = createFetchItems({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		getFieldAttributes,
	});
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
	const getPrimaryKeyName = (model: string) =>
		getFieldName({ model, field: "id" });

	return async ({
		model,
		where,
		update,
		limit,
		returnUpdatedItems,
	}: UpdateExecutionInput): Promise<UpdateExecutionResult> => {
		const tableName = resolveModelTableName(model);
		const mappedWhere = mapWhereFilters(where);
		const result = await fetchItems({
			model,
			where: mappedWhere,
			limit,
		});

		const filteredItems = applyClientFilter({
			items: result.items,
			where: mappedWhere,
			model,
			getFieldName,
			requiresClientFilter: result.requiresClientFilter,
		});

		if (filteredItems.length === 0) {
			return { updatedCount: 0, updatedItems: [] };
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const updateExpression = buildUpdateExpression(
			update as Record<string, NativeAttributeValue>,
		);
		const state: UpdateExecutionResult = {
			updatedCount: 0,
			updatedItems: [],
		};

		for (const item of filteredItems) {
			const key = buildPrimaryKey({
				item: item as DynamoDBItem,
				keyField: primaryKeyName,
			});
			if (transactionState) {
				addTransactionOperation(transactionState, {
					kind: "update",
					tableName,
					key,
					updateExpression: updateExpression.updateExpression,
					expressionAttributeNames:
						updateExpression.expressionAttributeNames,
					expressionAttributeValues:
						updateExpression.expressionAttributeValues,
				});
				if (returnUpdatedItems) {
					state.updatedItems.push(
						applyUpdateData(
							item as Record<string, unknown>,
							update as Record<string, unknown>,
						),
					);
				}
			} else {
				const commandInput = {
					TableName: tableName,
					Key: key,
					UpdateExpression: updateExpression.updateExpression,
					ExpressionAttributeNames:
						updateExpression.expressionAttributeNames,
					ExpressionAttributeValues:
						updateExpression.expressionAttributeValues,
					...buildReturnValues(returnUpdatedItems),
				};
				const updateResult = await documentClient.send(
					new UpdateCommand(commandInput),
				);
				if (returnUpdatedItems && updateResult.Attributes) {
					state.updatedItems.push(
						updateResult.Attributes as Record<string, unknown>,
					);
				}
			}
			state.updatedCount += 1;
		}

		return state;
	};
};

export const createUpdateManyMethod = (
	client: AdapterClientContainer,
	options: UpdateMethodOptions,
) => {
	const executeUpdate = createUpdateExecutor(client, options);

	return async ({
		model,
		where,
		update,
	}: {
		model: string;
		where: Where[];
		update: Record<string, unknown>;
	}) => {
		const result = await executeUpdate({
			model,
			where,
			update,
			returnUpdatedItems: false,
		});
		return result.updatedCount;
	};
};
