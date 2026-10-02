/**
 * @file Shared building blocks for the atomic single-row methods
 * (consumeOne / incrementOne).
 *
 * DynamoDB can only delete or update an item by its full primary key, so an
 * atomic method first resolves the row a where clause selects and then issues
 * a keyed write whose ConditionExpression re-checks the where clause. A failed
 * condition means the row changed after it was read; the caller resolves the
 * target again and retries.
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import { normalizeWhere } from "../adapter/planner/normalize-where";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import {
	applyWhereFilters,
	type DynamoDBItem,
} from "../adapter/executor/where-evaluator";
import type { AtomicCondition } from "../dynamodb/expressions/build-atomic-condition";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	findTransactionItem,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";
import type { AdapterClientContainer } from "./client-container";

/**
 * How many times an atomic method re-resolves its target after the condition
 * of its write failed. Every failure means another writer changed the row in
 * between, so retries end as soon as the row stops matching or the write wins.
 * The bound mirrors the compare-and-swap budget of Better Auth's own atomic
 * fallback (`MAX_ATTEMPTS` in `@better-auth/core/db/adapter`), which also
 * raises an error instead of reporting "no row matched" when it runs out.
 */
export const MAX_ATOMIC_WRITE_ATTEMPTS = 5;

export type AtomicMethodOptions = {
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
	transactionState?: DynamoDBTransactionState | undefined;
};

export type AtomicTarget = {
	key: Record<string, NativeAttributeValue>;
	snapshot: DynamoDBItem;
};

export type PinnedPrimaryKey =
	| { pinned: true; value: NativeAttributeValue | null | undefined }
	| { pinned: false };

export const toDynamoWhere = (where: Where[]): DynamoDBWhere[] =>
	normalizeWhere({ where }).map((entry) => ({
		field: entry.field,
		operator: entry.operator,
		value: entry.value,
		connector: entry.connector,
	}));

/**
 * Resolve the primary key value when the where clause selects one row by its
 * primary key (an AND-connected equality on the key attribute).
 */
export const resolvePinnedPrimaryKey = (props: {
	model: string;
	where: Where[];
	primaryKeyName: string;
	getFieldName: (args: { model: string; field: string }) => string;
}): PinnedPrimaryKey => {
	const entry = normalizeWhere({ where: props.where }).find(
		(candidate) =>
			candidate.connector === "AND" &&
			candidate.operator === "eq" &&
			props.getFieldName({ model: props.model, field: candidate.field }) ===
				props.primaryKeyName,
	);
	if (!entry) {
		return { pinned: false };
	}
	return {
		pinned: true,
		value: entry.value as NativeAttributeValue | null | undefined,
	};
};

export const buildConditionInput = (
	condition: AtomicCondition,
	extra?: {
		conditions: string[];
		expressionAttributeNames: Record<string, string>;
		expressionAttributeValues: Record<string, NativeAttributeValue>;
	},
): {
	ConditionExpression: string;
	ExpressionAttributeNames: Record<string, string>;
	ExpressionAttributeValues?: Record<string, NativeAttributeValue>;
} => {
	const expressionAttributeValues = {
		...condition.expressionAttributeValues,
		...extra?.expressionAttributeValues,
	};
	const input = {
		ConditionExpression: [
			condition.conditionExpression,
			...(extra?.conditions ?? []),
		].join(" AND "),
		ExpressionAttributeNames: {
			...condition.expressionAttributeNames,
			...extra?.expressionAttributeNames,
		},
	};
	// DynamoDB rejects an empty ExpressionAttributeValues map.
	if (Object.keys(expressionAttributeValues).length === 0) {
		return input;
	}
	return { ...input, ExpressionAttributeValues: expressionAttributeValues };
};

export const createContentionError = (method: string): DynamoDBAdapterError =>
	new DynamoDBAdapterError(
		"ATOMIC_WRITE_CONTENTION",
		`${method} could not settle after ${MAX_ATOMIC_WRITE_ATTEMPTS} attempts: the target row kept changing between the read and the conditional write.`,
	);

/**
 * Create the resolver that turns a where clause into the keyed row an atomic
 * write targets, or `null` when no row matches.
 *
 * A where clause that pins the primary key is read with a strongly consistent
 * GetItem and checked against the remaining predicates in memory. Any other
 * where clause goes through the query planner, exactly like update / delete.
 * Inside a transaction both paths see the transaction's own writes.
 */
export const createAtomicTargetResolver = (
	client: AdapterClientContainer,
	options: AtomicMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;
	const executePlan = createQueryPlanExecutor({
		documentClient,
		adapterConfig,
		getFieldName,
		getDefaultModelName,
		transactionState,
	});

	const readPinnedRow = async (props: {
		tableName: string;
		primaryKeyName: string;
		value: NativeAttributeValue;
	}): Promise<DynamoDBItem | null> => {
		if (transactionState) {
			const buffered = findTransactionItem(transactionState, {
				tableName: props.tableName,
				keyField: props.primaryKeyName,
				keyValue: props.value,
			});
			if (buffered) {
				return buffered.current;
			}
		}
		const output = await documentClient.send(
			new GetCommand({
				TableName: props.tableName,
				Key: { [props.primaryKeyName]: props.value },
				ConsistentRead: true,
			}),
		);
		return output.Item ?? null;
	};

	const resolvePinnedTarget = async (props: {
		model: string;
		where: Where[];
		primaryKeyName: string;
		value: NativeAttributeValue | null | undefined;
	}): Promise<AtomicTarget | null> => {
		if (props.value === undefined || props.value === null) {
			return null;
		}
		const row = await readPinnedRow({
			tableName: resolveTableName({
				model: props.model,
				getDefaultModelName,
				config: adapterConfig,
			}),
			primaryKeyName: props.primaryKeyName,
			value: props.value,
		});
		if (!row) {
			return null;
		}
		const matches = applyWhereFilters({
			items: [row],
			where: normalizeWhere({ where: props.where }),
		});
		if (matches.length === 0) {
			return null;
		}
		return {
			key: { [props.primaryKeyName]: props.value },
			snapshot: matches[0],
		};
	};

	return async (props: {
		model: string;
		where: Where[];
	}): Promise<AtomicTarget | null> => {
		const primaryKeyName = getFieldName({ model: props.model, field: "id" });
		const pinned = resolvePinnedPrimaryKey({
			model: props.model,
			where: props.where,
			primaryKeyName,
			getFieldName,
		});
		if (pinned.pinned) {
			return resolvePinnedTarget({
				model: props.model,
				where: props.where,
				primaryKeyName,
				value: pinned.value,
			});
		}

		const plan = buildQueryPlan({
			model: props.model,
			where: props.where,
			select: undefined,
			sortBy: undefined,
			limit: 1,
			offset: undefined,
			join: undefined,
			getFieldName,
			adapterConfig,
		});
		const items = await executePlan(plan);
		if (items.length === 0) {
			return null;
		}
		return {
			key: buildPrimaryKey({ item: items[0], keyField: primaryKeyName }),
			snapshot: items[0],
		};
	};
};
