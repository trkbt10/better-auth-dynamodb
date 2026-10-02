/**
 * @file Shared building blocks for the atomic single-row methods
 * (consumeOne / incrementOne).
 *
 * DynamoDB can only delete or update an item by its full primary key, so an
 * atomic method first resolves the row a where clause selects and then issues
 * a keyed write whose ConditionExpression re-checks the where clause.
 *
 * A row found through an index or a scan may be stale: those reads are
 * eventually consistent. So when the condition fails, the row is read again
 * by its key, strongly consistently. Only that read decides whether the row
 * is gone (look for another one) or still matches (retry with what it holds
 * now).
 */
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { buildQueryPlan } from "../adapter/planner/build-query-plan";
import {
	normalizeWhere,
	toDynamoWhere,
} from "../adapter/planner/normalize-where";
import { createQueryPlanExecutor } from "../adapter/executor/execute-query-plan";
import {
	applyWhereFilters,
	type DynamoDBItem,
} from "../adapter/executor/where-evaluator";
import type { AtomicCondition } from "../dynamodb/expressions/build-atomic-condition";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import { isCaseInsensitiveComparison } from "../dynamodb/expressions/where-operator";
import type { ConditionalWriteResult } from "../dynamodb/ops/conditional-write";
import { buildPrimaryKey } from "../dynamodb/mapping/build-primary-key";
import { resolveTableName } from "../dynamodb/mapping/resolve-table-name";
import {
	findTransactionItem,
	type DynamoDBTransactionState,
} from "../dynamodb/ops/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";
import type { AdapterClientContainer } from "./client-container";

/**
 * How many times an atomic method writes to one row. A write is repeated only
 * when its condition failed although a strongly consistent read shows the row
 * still matching, i.e. another writer changed it in between. The bound mirrors
 * the compare-and-swap budget of Better Auth's own atomic fallback
 * (`MAX_ATTEMPTS` in `@better-auth/core/db/adapter`), which also raises an
 * error instead of reporting "no row matched" when it runs out.
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

export const toAtomicWhere = (where: Where[]): DynamoDBWhere[] =>
	toDynamoWhere(normalizeWhere({ where }));

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
	const entry = normalizeWhere({ where: props.where }).find((candidate) => {
		if (candidate.connector !== "AND" || candidate.operator !== "eq") {
			return false;
		}
		// A case-insensitive match is not a key lookup. A null value is: no
		// row has a null primary key, so it pins the lookup to nothing.
		if (isCaseInsensitiveComparison(candidate)) {
			return false;
		}
		return (
			props.getFieldName({ model: props.model, field: candidate.field }) ===
			props.primaryKeyName
		);
	});
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

// Key values are compared by a token of their type and text, so a value that
// is a new object on every read (a binary key) still equals itself.
const toKeyToken = (value: NativeAttributeValue): string =>
	`${typeof value}:${String(value)}`;

export const createContentionError = (method: string): DynamoDBAdapterError =>
	new DynamoDBAdapterError(
		"ATOMIC_WRITE_CONTENTION",
		`${method} could not settle after ${MAX_ATOMIC_WRITE_ATTEMPTS} attempts: the target row kept changing between the read and the conditional write.`,
	);

/**
 * Create the reads an atomic method resolves its target row with.
 *
 * - `readMatchingRow` reads one row by primary key, strongly consistently,
 *   and checks the where clause against it in memory.
 * - `findCandidate` goes through the query planner, exactly like update /
 *   delete. Its result can be stale.
 * - `resolveTarget` picks between the two: a where clause that pins the
 *   primary key needs no planner.
 *
 * Inside a transaction all of them see the transaction's own writes.
 */
export const createAtomicRowReader = (
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

	const readRow = async (props: {
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

	const readMatchingRow = async (props: {
		model: string;
		where: Where[];
		keyValue: NativeAttributeValue | null | undefined;
	}): Promise<AtomicTarget | null> => {
		if (props.keyValue === undefined || props.keyValue === null) {
			return null;
		}
		const primaryKeyName = getFieldName({ model: props.model, field: "id" });
		const row = await readRow({
			tableName: resolveTableName({
				model: props.model,
				getDefaultModelName,
				config: adapterConfig,
			}),
			primaryKeyName,
			value: props.keyValue,
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
		return { key: { [primaryKeyName]: props.keyValue }, snapshot: matches[0] };
	};

	const findCandidate = async (props: {
		model: string;
		where: Where[];
		excludedKeyValues: string[];
	}): Promise<AtomicTarget | null> => {
		const primaryKeyName = getFieldName({ model: props.model, field: "id" });
		const plan = buildQueryPlan({
			model: props.model,
			where: props.where,
			select: undefined,
			sortBy: undefined,
			limit: props.excludedKeyValues.length + 1,
			offset: undefined,
			join: undefined,
			getFieldName,
			adapterConfig,
		});
		const items = await executePlan(plan);
		const candidate = items.find(
			(item) =>
				!props.excludedKeyValues.includes(toKeyToken(item[primaryKeyName])),
		);
		if (!candidate) {
			return null;
		}
		return {
			key: buildPrimaryKey({ item: candidate, keyField: primaryKeyName }),
			snapshot: candidate,
		};
	};

	const resolvePinned = (props: { model: string; where: Where[] }) =>
		resolvePinnedPrimaryKey({
			model: props.model,
			where: props.where,
			primaryKeyName: getFieldName({ model: props.model, field: "id" }),
			getFieldName,
		});

	const resolveTarget = async (props: {
		model: string;
		where: Where[];
	}): Promise<AtomicTarget | null> => {
		const pinned = resolvePinned(props);
		if (pinned.pinned) {
			return readMatchingRow({ ...props, keyValue: pinned.value });
		}
		return findCandidate({ ...props, excludedKeyValues: [] });
	};

	return { readMatchingRow, findCandidate, resolvePinned, resolveTarget };
};

export type AtomicRowReader = ReturnType<typeof createAtomicRowReader>;

type WriteAttempt =
	| { outcome: "written"; row: DynamoDBItem }
	| { outcome: "failed" }
	| { outcome: "rejected"; error: unknown };

const isInvalidUpdate = (error: unknown): boolean => {
	if (!(error instanceof DynamoDBAdapterError)) {
		return false;
	}
	return error.code === "INVALID_UPDATE";
};

// A write can be refused before it is sent because of what the row holds (a
// counter that is not a number). That verdict is only final for a row that
// was read consistently; for a stale candidate it is checked again.
const attemptWrite = async (
	write: (target: AtomicTarget) => Promise<ConditionalWriteResult>,
	target: AtomicTarget,
): Promise<WriteAttempt> => {
	try {
		const result = await write(target);
		if (result.applied && result.attributes) {
			return { outcome: "written", row: result.attributes };
		}
		return { outcome: "failed" };
	} catch (error) {
		if (isInvalidUpdate(error)) {
			return { outcome: "rejected", error };
		}
		throw error;
	}
};

/**
 * Write to one row until the write is applied or the row stops matching.
 * Returns the row the write reports, or `null` when a strongly consistent
 * read shows that the row is gone or no longer matches the where clause.
 * `verified` says whether `target` already comes from such a read.
 */
const settleOnRow = async (props: {
	method: string;
	target: AtomicTarget;
	verified: boolean;
	write: (target: AtomicTarget) => Promise<ConditionalWriteResult>;
	reread: () => Promise<AtomicTarget | null>;
}): Promise<DynamoDBItem | null> => {
	const state = { target: props.target, verified: props.verified };
	for (let attempt = 0; attempt < MAX_ATOMIC_WRITE_ATTEMPTS; attempt += 1) {
		const result = await attemptWrite(props.write, state.target);
		if (result.outcome === "written") {
			return result.row;
		}
		if (result.outcome === "rejected" && state.verified) {
			throw result.error;
		}
		const fresh = await props.reread();
		if (!fresh) {
			return null;
		}
		state.target = fresh;
		state.verified = true;
	}
	throw createContentionError(props.method);
};

/**
 * Apply a conditional write to a single row matching the where clause.
 *
 * Returns the row the write reports, or `null` when no row matches. A
 * candidate that turns out to be gone or changed is left out of the next
 * lookup, so a stale index entry cannot be picked twice and another matching
 * row is still reached.
 */
export const settleAtomicWrite = async (props: {
	method: string;
	reader: AtomicRowReader;
	model: string;
	where: Where[];
	write: (target: AtomicTarget) => Promise<ConditionalWriteResult>;
}): Promise<DynamoDBItem | null> => {
	const { reader, model, where } = props;
	const pinned = reader.resolvePinned({ model, where });
	if (pinned.pinned) {
		const reread = () =>
			reader.readMatchingRow({ model, where, keyValue: pinned.value });
		const target = await reread();
		if (!target) {
			return null;
		}
		return settleOnRow({
			method: props.method,
			target,
			verified: true,
			write: props.write,
			reread,
		});
	}

	const excludedKeyValues: string[] = [];
	for (;;) {
		const candidate = await reader.findCandidate({
			model,
			where,
			excludedKeyValues,
		});
		if (!candidate) {
			return null;
		}
		const keyValue = Object.values(candidate.key)[0];
		const row = await settleOnRow({
			method: props.method,
			target: candidate,
			verified: false,
			write: props.write,
			reread: () => reader.readMatchingRow({ model, where, keyValue }),
		});
		if (row) {
			return row;
		}
		excludedKeyValues.push(toKeyToken(keyValue));
	}
};
