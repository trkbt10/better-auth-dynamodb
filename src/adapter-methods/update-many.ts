/**
 * @file Update-many method for the DynamoDB adapter.
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import { buildUpdateExpression } from "../dynamodb/query-utils/build-update-expression";
import { buildPrimaryKey } from "../dynamodb/query-utils/build-primary-key";
import { addTransactionOperation } from "../dynamodb/query-utils/transaction";
import type { DynamoDBItem } from "../dynamodb/query-utils/where-evaluator";
import type { AdapterMethodContext } from "./types";

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

export const createUpdateExecutor = (context: AdapterMethodContext) => {
	const {
		documentClient,
		fetchItems,
		applyClientFilter,
		mapWhereFilters,
		resolveModelTableName,
		getPrimaryKeyName,
		transactionState,
	} = context;

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
					...(returnUpdatedItems
						? { ReturnValues: "ALL_NEW" as const }
						: {}),
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

export const createUpdateManyMethod = (context: AdapterMethodContext) => {
	const executeUpdate = createUpdateExecutor(context);

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
