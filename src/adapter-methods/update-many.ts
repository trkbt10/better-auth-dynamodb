/**
 * @file Update-many method for the DynamoDB adapter.
 */
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { buildPatchUpdateExpression } from "../dynamodb/expressions/build-patch-update-expression";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	addTransactionOperation,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { DynamoDBItem } from "../adapter/executor/where-evaluator";
import type { AdapterClientContainer } from "./client-container";

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

const applyPatchData = <T extends Record<string, unknown>>(
	item: T,
	update: Record<string, unknown>,
): Record<string, unknown> =>
	Object.entries(update).reduce<Record<string, unknown>>(
		(acc, [key, value]) => ({ ...acc, [key]: value }),
		{ ...item },
	);

const stripUndefined = <T extends Record<string, unknown>>(item: T): T => {
	const filtered = Object.entries(item).reduce<Record<string, unknown>>(
		(acc, [key, value]) => {
			if (value === undefined) {
				return acc;
			}
			return { ...acc, [key]: value };
		},
		{},
	);
	return filtered as T;
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
	const executePlan = createQueryPlanExecutor({
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
		const plan = buildQueryPlan({
			model,
			where,
			select: undefined,
			sortBy: undefined,
			limit,
			offset: undefined,
			join: undefined,
			getFieldName,
			getFieldAttributes,
			adapterConfig,
		});
		const filteredItems = await executePlan(plan);

		if (filteredItems.length === 0) {
			return { updatedCount: 0, updatedItems: [] };
		}

		const primaryKeyName = getPrimaryKeyName(model);
		const state: UpdateExecutionResult = {
			updatedCount: 0,
			updatedItems: [],
		};

		for (const item of filteredItems) {
			const nextItem = applyPatchData(
				item as Record<string, unknown>,
				update as Record<string, unknown>,
			);
			const updateExpression = buildPatchUpdateExpression({
				prev: item as Record<string, unknown>,
				next: nextItem,
			});
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
						stripUndefined(nextItem as Record<string, unknown>),
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
