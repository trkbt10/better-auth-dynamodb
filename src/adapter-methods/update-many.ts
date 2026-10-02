/**
 * @file Update-many method for the DynamoDB adapter.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { buildUpdateExpression } from "../dynamodb/expressions/build-update-expression";
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

// The attributes an update assigns. A null index key attribute cannot be
// stored, so it is removed instead (`undefined`). The primary key is left out
// when it is merely repeated; DynamoDB does not accept it in an update.
const resolveAssignments = (props: {
	item: DynamoDBItem;
	update: Record<string, unknown>;
	primaryKeyName: string;
	indexKeyAttributes: string[];
}): Record<string, DynamoDBItem[string] | undefined> =>
	Object.entries(props.update).reduce<
		Record<string, DynamoDBItem[string] | undefined>
	>((acc, [key, value]) => {
		if (key === props.primaryKeyName && value === props.item[key]) {
			return acc;
		}
		if (value === null && props.indexKeyAttributes.includes(key)) {
			return { ...acc, [key]: undefined };
		}
		return { ...acc, [key]: value as DynamoDBItem[string] | undefined };
	}, {});

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
		assignments: Record<string, DynamoDBItem[string] | undefined>;
		nextItem: DynamoDBItem;
		returnUpdatedItems: boolean;
	}): Promise<DynamoDBItem | undefined> => {
		const expression = buildUpdateExpression(props.assignments);
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
		return result.attributes ?? props.nextItem;
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

		const indexKeyAttributes =
			adapterConfig.resolveIndexKeyAttributes?.(model) ?? [];

		for (const item of filteredItems) {
			const assignments = resolveAssignments({
				item,
				update,
				primaryKeyName,
				indexKeyAttributes,
			});
			const nextItem = stripUndefined({ ...item, ...assignments });
			if (Object.keys(assignments).length === 0) {
				state.updatedItems.push(item);
				state.updatedCount += 1;
				continue;
			}
			if (transactionState) {
				bufferTransactionWrite(transactionState, {
					tableName,
					keyField: primaryKeyName,
					row: item,
					next: nextItem,
					assignedFields: Object.keys(assignments),
				});
				state.updatedItems.push(nextItem);
				state.updatedCount += 1;
				continue;
			}
			const updated = await writeUpdate({
				tableName,
				primaryKeyName,
				item,
				assignments,
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
