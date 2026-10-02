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
import { sendConditionalDelete } from "../dynamodb/ops/conditional-write";
import {
	bufferTransactionWrite,
	pinTransactionFields,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { AdapterClientContainer } from "./client-container";
import {
	MAX_ATOMIC_WRITE_ATTEMPTS,
	buildConditionInput,
	createAtomicTargetResolver,
	createContentionError,
	resolvePinnedPrimaryKey,
	toAtomicWhere,
	type AtomicMethodOptions,
	type AtomicTarget,
} from "./atomic-write";

export const createConsumeOneMethod = (
	client: AdapterClientContainer,
	options: AtomicMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;
	const resolveTarget = createAtomicTargetResolver(client, options);

	// The delete is buffered until the transaction commits, so the row handed
	// back is the one the transaction read. Every attribute of the stored row
	// is pinned: the commit only succeeds while it is still the row returned.
	const consumeInTransaction = (props: {
		state: DynamoDBTransactionState;
		tableName: string;
		primaryKeyName: string;
		target: AtomicTarget;
	}): AtomicTarget["snapshot"] => {
		const entry = bufferTransactionWrite(props.state, {
			tableName: props.tableName,
			keyField: props.primaryKeyName,
			row: props.target.snapshot,
			next: null,
		});
		pinTransactionFields(entry, Object.keys(entry.base ?? {}));
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
		const dynamoWhere = toAtomicWhere(where);

		if (transactionState) {
			const target = await resolveTarget({ model, where });
			if (!target) {
				return null;
			}
			const consumed = consumeInTransaction({
				state: transactionState,
				tableName,
				primaryKeyName,
				target,
			});
			return consumed as T;
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
			const result = await sendConditionalDelete(documentClient, {
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
			const result = await sendConditionalDelete(documentClient, {
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
