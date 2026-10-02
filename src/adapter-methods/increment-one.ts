/**
 * @file Increment-one method for the DynamoDB adapter.
 *
 * Applies signed deltas (and absolute `set` values) to a single row matching
 * the where clause, which is both the selector and the guard. The mutation is
 * an UpdateItem whose arithmetic runs inside DynamoDB and whose
 * ConditionExpression re-checks the guard, so concurrent calls neither lose
 * updates nor mutate a row that stopped matching.
 */
import type { Where } from "@better-auth/core/db/adapter";
import { buildAtomicCondition } from "../dynamodb/expressions/build-atomic-condition";
import {
	buildIncrementExpression,
	hasIncrementAssignments,
	resolveIncrementAssignments,
} from "../dynamodb/expressions/build-increment-expression";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import { sendConditionalUpdate } from "../dynamodb/ops/conditional-write";
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
	toAtomicWhere,
	type AtomicMethodOptions,
	type AtomicTarget,
} from "./atomic-write";

export const createIncrementOneMethod = (
	client: AdapterClientContainer,
	options: AtomicMethodOptions,
) => {
	const { documentClient } = client;
	const { adapterConfig, getFieldName, getDefaultModelName, transactionState } =
		options;
	const resolveTarget = createAtomicTargetResolver(client, options);

	// The update is buffered until the transaction commits, so the row handed
	// back is computed from the row the transaction read. The guard fields and
	// the counters of the stored row are pinned: the commit only succeeds while
	// they still hold the values the returned row was computed from.
	const incrementInTransaction = (props: {
		state: DynamoDBTransactionState;
		tableName: string;
		primaryKeyName: string;
		target: AtomicTarget;
		next: AtomicTarget["snapshot"];
		pinnedFields: string[];
	}): AtomicTarget["snapshot"] => {
		const entry = bufferTransactionWrite(props.state, {
			tableName: props.tableName,
			keyField: props.primaryKeyName,
			row: props.target.snapshot,
			next: props.next,
		});
		pinTransactionFields(entry, props.pinnedFields);
		return props.next;
	};

	return async <T>({
		model,
		where,
		increment,
		set,
	}: {
		model: string;
		where: Where[];
		increment: Record<string, number>;
		set?: Record<string, unknown> | undefined;
	}): Promise<T | null> => {
		const assignments = resolveIncrementAssignments({
			increment,
			set,
			indexKeyAttributes: adapterConfig.resolveIndexKeyAttributes?.(model),
		});
		const tableName = resolveTableName({
			model,
			getDefaultModelName,
			config: adapterConfig,
		});
		const primaryKeyName = getFieldName({ model, field: "id" });
		const dynamoWhere = toAtomicWhere(where);

		for (let attempt = 0; attempt < MAX_ATOMIC_WRITE_ATTEMPTS; attempt += 1) {
			const target = await resolveTarget({ model, where });
			if (!target) {
				return null;
			}
			if (!hasIncrementAssignments(assignments)) {
				return target.snapshot as T;
			}
			const expression = buildIncrementExpression({
				snapshot: target.snapshot,
				assignments,
			});

			if (transactionState) {
				const next = incrementInTransaction({
					state: transactionState,
					tableName,
					primaryKeyName,
					target,
					next: expression.nextItem,
					pinnedFields: [
						...dynamoWhere.map((entry) =>
							getFieldName({ model, field: entry.field }),
						),
						...Object.keys(assignments.increment),
					],
				});
				return next as T;
			}

			const result = await sendConditionalUpdate(documentClient, {
				TableName: tableName,
				Key: target.key,
				UpdateExpression: expression.updateExpression,
				...buildConditionInput(
					buildAtomicCondition({
						model,
						where: dynamoWhere,
						primaryKeyName,
						getFieldName,
						snapshot: target.snapshot,
					}),
					{
						conditions: expression.counterConditions,
						expressionAttributeNames: expression.expressionAttributeNames,
						expressionAttributeValues: expression.expressionAttributeValues,
					},
				),
				ReturnValues: "ALL_NEW",
			});
			if (result.applied && result.attributes) {
				return result.attributes as T;
			}
		}

		throw createContentionError("incrementOne");
	};
};
