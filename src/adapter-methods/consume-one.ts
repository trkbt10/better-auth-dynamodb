/**
 * @file Consume-one method for the DynamoDB adapter.
 *
 * Deletes a single row matching the where clause and returns it. Under
 * concurrent calls for the same row exactly one caller receives it: the delete
 * is a DeleteItem whose ConditionExpression re-checks the where clause, and
 * the row handed back is the one DynamoDB reports as deleted (ALL_OLD).
 */
import type { Where } from "@better-auth/core/db/adapter";
import {
	buildAtomicCondition,
	canEvaluateWhereOnServer,
} from "../dynamodb/expressions/build-atomic-condition";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	addTransactionOperation,
	hasBufferedDelete,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";
import type { AdapterClientContainer } from "./client-container";
import {
	MAX_ATOMIC_WRITE_ATTEMPTS,
	buildConditionInput,
	createAtomicTargetResolver,
	createContentionError,
	resolvePinnedPrimaryKey,
	sendConditionalDelete,
	toDynamoWhere,
	type AtomicMethodOptions,
	type AtomicTarget,
} from "./atomic-write";

export const createConsumeOneMethod = (
	client: AdapterClientContainer,
	options: AtomicMethodOptions,
) => {
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;
	const resolveTarget = createAtomicTargetResolver(client, options);

	// The delete is buffered until the transaction commits, so the row handed
	// back is the snapshot. Every snapshot attribute is pinned: the commit only
	// succeeds while the stored row is still the one that was returned.
	const consumeInTransaction = (props: {
		state: DynamoDBTransactionState;
		tableName: string;
		model: string;
		where: DynamoDBWhere[];
		primaryKeyName: string;
		target: AtomicTarget;
	}): AtomicTarget["snapshot"] | null => {
		const buffered = { tableName: props.tableName, key: props.target.key };
		if (hasBufferedDelete(props.state, buffered)) {
			return null;
		}
		addTransactionOperation(props.state, {
			kind: "delete",
			tableName: props.tableName,
			key: props.target.key,
			condition: buildAtomicCondition({
				model: props.model,
				where: props.where,
				primaryKeyName: props.primaryKeyName,
				getFieldName,
				snapshot: props.target.snapshot,
				pinnedFields: Object.keys(props.target.snapshot),
			}),
		});
		return props.target.snapshot;
	};

	return async <T>({
		model,
		where,
	}: {
		model: string;
		where: Where[];
	}): Promise<T | null> => {
		const tableName = resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
		const primaryKeyName = getFieldName({ model, field: "id" });
		const dynamoWhere = toDynamoWhere(where);

		if (transactionState) {
			const target = await resolveTarget({ model, where });
			if (!target) {
				return null;
			}
			const consumed = consumeInTransaction({
				state: transactionState,
				tableName,
				model,
				where: dynamoWhere,
				primaryKeyName,
				target,
			});
			return consumed as T | null;
		}

		// A where clause that pins the primary key and that DynamoDB can evaluate
		// by itself needs no prior read: one conditional DeleteItem decides.
		const pinned = resolvePinnedPrimaryKey({
			model,
			where,
			primaryKeyName,
			getFieldName,
		});
		if (pinned.pinned && canEvaluateWhereOnServer(dynamoWhere)) {
			if (pinned.value === undefined || pinned.value === null) {
				return null;
			}
			const result = await sendConditionalDelete(client, {
				TableName: tableName,
				Key: { [primaryKeyName]: pinned.value },
				...buildConditionInput(
					buildAtomicCondition({
						model,
						where: dynamoWhere,
						primaryKeyName,
						getFieldName,
					}),
				),
				ReturnValues: "ALL_OLD",
			});
			if (!result.applied) {
				return null;
			}
			return (result.attributes ?? null) as T | null;
		}

		for (let attempt = 0; attempt < MAX_ATOMIC_WRITE_ATTEMPTS; attempt += 1) {
			const target = await resolveTarget({ model, where });
			if (!target) {
				return null;
			}
			const result = await sendConditionalDelete(client, {
				TableName: tableName,
				Key: target.key,
				...buildConditionInput(
					buildAtomicCondition({
						model,
						where: dynamoWhere,
						primaryKeyName,
						getFieldName,
						snapshot: target.snapshot,
					}),
				),
				ReturnValues: "ALL_OLD",
			});
			if (result.applied && result.attributes) {
				return result.attributes as T;
			}
		}

		throw createContentionError("consumeOne");
	};
};
