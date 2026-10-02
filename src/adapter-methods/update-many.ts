/**
 * @file Update-many method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { resolvePatchUpdateExpression } from "../dynamodb/expressions/build-patch-update-expression";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { sendConditionalUpdate } from "../dynamodb/ops/conditional-write";
import {
	bufferTransactionWrite,
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

// A null index key attribute cannot be stored; the attribute is removed instead.
const applyPatchData = (
	item: DynamoDBItem,
	update: Record<string, unknown>,
	indexKeyAttributes: string[],
): Record<string, unknown> =>
	Object.entries(update).reduce<Record<string, unknown>>(
		(acc, [key, value]) => {
			if (value === null && indexKeyAttributes.includes(key)) {
				return { ...acc, [key]: undefined };
			}
			return { ...acc, [key]: value };
		},
		{ ...item },
	);

const stripUndefined = (item: Record<string, unknown>): DynamoDBItem =>
	Object.entries(item).reduce<DynamoDBItem>((acc, [key, value]) => {
		if (value === undefined) {
			return acc;
		}
		return { ...acc, [key]: value as DynamoDBItem[string] };
	}, {});

const buildReturnValues = (returnUpdatedItems: boolean) => {
	if (returnUpdatedItems) {
		return { ReturnValues: "ALL_NEW" as const };
	}
	return {};
};

// DynamoDB rejects an empty ExpressionAttributeValues map (a REMOVE-only update has none).
const buildAttributeValues = (values: DynamoDBItem) => {
	if (Object.keys(values).length === 0) {
		return {};
	}
	return { ExpressionAttributeValues: values };
};

export type UpdateMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
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
		transactionState,
	} = options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		transactionState,
	});
	const resolveModelTableName = (model: string) =>
		resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
	const getPrimaryKeyName = (model: string) =>
		getFieldName({ model, field: "id" });

	// Returns the row as stored after the update, or `undefined` when the row
	// no longer exists. Without the existence check an update of a row deleted
	// after it was read would create a partial row holding only the update.
	const writeUpdate = async (props: {
		tableName: string;
		primaryKeyName: string;
		item: DynamoDBItem;
		nextItem: Record<string, unknown>;
		returnUpdatedItems: boolean;
	}): Promise<DynamoDBItem | undefined> => {
		const expression = resolvePatchUpdateExpression({
			prev: props.item,
			next: props.nextItem,
		});
		if (!expression) {
			return props.item;
		}
		const result = await sendConditionalUpdate(documentClient, {
			TableName: props.tableName,
			Key: buildPrimaryKey({
				item: props.item,
				keyField: props.primaryKeyName,
			}),
			UpdateExpression: expression.updateExpression,
			ConditionExpression: "attribute_exists(#pk)",
			ExpressionAttributeNames: {
				...expression.expressionAttributeNames,
				"#pk": props.primaryKeyName,
			},
			...buildAttributeValues(expression.expressionAttributeValues),
			...buildReturnValues(props.returnUpdatedItems),
		});
		if (!result.applied) {
			return undefined;
		}
		return result.attributes ?? stripUndefined(props.nextItem);
	};

	return async ({
		model,
		where,
		update,
		limit,
		returnUpdatedItems,
	}: UpdateExecutionInput): Promise<UpdateExecutionResult> => {
		if (Object.keys(update).length === 0) {
			throw new DynamoDBAdapterError(
				"INVALID_UPDATE",
				"Update payload must include at least one defined value.",
			);
		}
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
				item,
				update,
				adapterConfig.resolveIndexKeyAttributes?.(model) ?? [],
			);
			if (transactionState) {
				const next = stripUndefined(nextItem);
				bufferTransactionWrite(transactionState, {
					tableName,
					keyField: primaryKeyName,
					row: item,
					next,
				});
				state.updatedItems.push(next);
				state.updatedCount += 1;
				continue;
			}
			const updated = await writeUpdate({
				tableName,
				primaryKeyName,
				item,
				nextItem,
				returnUpdatedItems,
			});
			if (!updated) {
				continue;
			}
			state.updatedItems.push(updated);
			state.updatedCount += 1;
		}

		if (!returnUpdatedItems) {
			return { updatedCount: state.updatedCount, updatedItems: [] };
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
