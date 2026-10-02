/**
 * @file DynamoDB transaction helpers.
 *
 * Writes made through a transaction adapter are not sent one by one. The
 * transaction keeps one entry per item: the row as DynamoDB stored it when the
 * transaction first touched it (`base`) and the row after the buffered writes
 * (`current`). Reads inside the transaction are answered from that overlay, so
 * they see the transaction's own writes, and the commit sends exactly one
 * operation per item, which is what TransactWriteItems requires.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";
import { buildUpdateExpression } from "../expressions/build-update-expression";

type TransactionRow = Record<string, NativeAttributeValue>;

export type DynamoDBTransactionItem = {
	tableName: string;
	keyField: string;
	key: TransactionRow;
	/**
	 * The stored row when the transaction first touched the item, or
	 * `undefined` when the transaction created it.
	 */
	base: TransactionRow | undefined;
	/**
	 * The row after the buffered writes, or `null` when it is deleted.
	 */
	current: TransactionRow | null;
	/**
	 * Attributes of `base` the commit requires to be unchanged.
	 */
	pinnedFields: string[];
	/**
	 * Attributes the transaction assigned to a stored row. The commit writes
	 * exactly these, each as a whole value.
	 */
	assignedFields: string[];
	/**
	 * Whether the transaction deleted a stored row and created it again: the
	 * commit then replaces the row instead of updating attributes of it.
	 */
	replaced: boolean;
};

export type DynamoDBTransactionState = {
	items: DynamoDBTransactionItem[];
};

/**
 * TransactWriteItems accepts up to 100 actions per request.
 */
export const TRANSACTION_ITEM_LIMIT = 100;

export const createTransactionState = (): DynamoDBTransactionState => ({
	items: [],
});

export const findTransactionItem = (
	state: DynamoDBTransactionState,
	target: { tableName: string; keyField: string; keyValue: unknown },
): DynamoDBTransactionItem | undefined =>
	state.items.find((entry) => {
		if (entry.tableName !== target.tableName) {
			return false;
		}
		return Object.is(entry.key[target.keyField], target.keyValue);
	});

export const countTransactionItems = (
	state: DynamoDBTransactionState,
	tableName: string,
): number =>
	state.items.filter((entry) => entry.tableName === tableName).length;

export const hasTransactionItems = (
	state: DynamoDBTransactionState,
	tableName: string,
): boolean => countTransactionItems(state, tableName) > 0;

const addTransactionItem = (
	state: DynamoDBTransactionState,
	entry: DynamoDBTransactionItem,
): void => {
	state.items.push(entry);
};

const resolveKeyValue = (props: {
	item: TransactionRow;
	keyField: string;
}): NativeAttributeValue => {
	if (!(props.keyField in props.item)) {
		throw new DynamoDBAdapterError(
			"MISSING_PRIMARY_KEY",
			`Item is missing primary key field "${props.keyField}".`,
		);
	}
	return props.item[props.keyField];
};

/**
 * Buffer the creation of a row. A row the transaction already holds cannot be
 * created again; a row it deleted earlier is replaced.
 */
export const bufferTransactionCreate = (
	state: DynamoDBTransactionState,
	props: { tableName: string; keyField: string; item: TransactionRow },
): void => {
	const keyValue = resolveKeyValue(props);
	const existing = findTransactionItem(state, {
		tableName: props.tableName,
		keyField: props.keyField,
		keyValue,
	});
	if (!existing) {
		addTransactionItem(state, {
			tableName: props.tableName,
			keyField: props.keyField,
			key: { [props.keyField]: keyValue },
			base: undefined,
			current: props.item,
			pinnedFields: [],
			assignedFields: [],
			replaced: false,
		});
		return;
	}
	if (existing.current !== null) {
		throw new DynamoDBAdapterError(
			"DUPLICATE_PRIMARY_KEY",
			`A row with ${props.keyField} "${String(keyValue)}" already exists in ${props.tableName}.`,
		);
	}
	existing.current = props.item;
	existing.replaced = existing.base !== undefined;
};

/**
 * Buffer the new image of a row the transaction read: `next` is the updated
 * row, or `null` to delete it. `row` is the image the write was computed from,
 * which is the stored row unless the transaction already holds the item.
 * `assignedFields` names the attributes an update assigned.
 */
export const bufferTransactionWrite = (
	state: DynamoDBTransactionState,
	props: {
		tableName: string;
		keyField: string;
		row: TransactionRow;
		next: TransactionRow | null;
		assignedFields?: string[] | undefined;
	},
): DynamoDBTransactionItem => {
	const assignedFields = props.assignedFields ?? [];
	const keyValue = resolveKeyValue({
		item: props.row,
		keyField: props.keyField,
	});
	const existing = findTransactionItem(state, {
		tableName: props.tableName,
		keyField: props.keyField,
		keyValue,
	});
	if (existing) {
		existing.current = props.next;
		existing.assignedFields = Array.from(
			new Set([...existing.assignedFields, ...assignedFields]),
		);
		return existing;
	}
	const entry: DynamoDBTransactionItem = {
		tableName: props.tableName,
		keyField: props.keyField,
		key: { [props.keyField]: keyValue },
		base: props.row,
		current: props.next,
		pinnedFields: [],
		assignedFields,
		replaced: false,
	};
	addTransactionItem(state, entry);
	return entry;
};

/**
 * Require the given attributes of the stored row to be unchanged at commit.
 */
export const pinTransactionFields = (
	entry: DynamoDBTransactionItem,
	fields: string[],
): void => {
	entry.pinnedFields = Array.from(new Set([...entry.pinnedFields, ...fields]));
};

/**
 * Replace the stored rows the transaction has written to with their buffered
 * images, and add the buffered rows that match.
 */
export const applyTransactionOverlay = <T extends TransactionRow>(
	state: DynamoDBTransactionState,
	props: {
		tableName: string;
		keyField: string;
		items: T[];
		matches: (item: TransactionRow) => boolean;
	},
): T[] => {
	const entries = state.items.filter(
		(entry) => entry.tableName === props.tableName,
	);
	if (entries.length === 0) {
		return props.items;
	}
	const untouched = props.items.filter(
		(item) =>
			!entries.some((entry) =>
				Object.is(entry.key[props.keyField], item[props.keyField]),
			),
	);
	const buffered = entries
		.map((entry) => entry.current)
		.filter((row): row is TransactionRow => row !== null)
		.filter((row) => props.matches(row));
	return [...untouched, ...(buffered as T[])];
};

type ExpressionInput = {
	expression: string;
	names: Record<string, string>;
	values: Record<string, NativeAttributeValue>;
};

// The stored row must still exist, with every pinned attribute unchanged.
const buildPinnedCondition = (
	entry: DynamoDBTransactionItem,
	base: TransactionRow,
): ExpressionInput => {
	const pins = entry.pinnedFields.map((field, index): ExpressionInput => {
		const nameToken = `#pin${index}`;
		const value = base[field];
		if (value === undefined) {
			return {
				expression: `attribute_not_exists(${nameToken})`,
				names: { [nameToken]: field },
				values: {},
			};
		}
		const valueToken = `:pin${index}`;
		return {
			expression: `${nameToken} = ${valueToken}`,
			names: { [nameToken]: field },
			values: { [valueToken]: value },
		};
	});
	const conditions: ExpressionInput[] = [
		{
			expression: "attribute_exists(#pk)",
			names: { "#pk": entry.keyField },
			values: {},
		},
		...pins,
	];
	return {
		expression: conditions.map((condition) => condition.expression).join(" AND "),
		names: conditions.reduce<Record<string, string>>(
			(acc, condition) => ({ ...acc, ...condition.names }),
			{},
		),
		values: conditions.reduce<Record<string, NativeAttributeValue>>(
			(acc, condition) => ({ ...acc, ...condition.values }),
			{},
		),
	};
};

// DynamoDB rejects an empty ExpressionAttributeNames / ExpressionAttributeValues map.
const buildAttributeInput = (props: {
	names: Record<string, string>;
	values: Record<string, NativeAttributeValue>;
}): Record<string, unknown> => {
	const input: Record<string, unknown> = {};
	if (Object.keys(props.names).length > 0) {
		input.ExpressionAttributeNames = props.names;
	}
	if (Object.keys(props.values).length > 0) {
		input.ExpressionAttributeValues = props.values;
	}
	return input;
};

const buildTransactItem = (
	entry: DynamoDBTransactionItem,
): Record<string, unknown> | undefined => {
	if (entry.base === undefined) {
		if (entry.current === null) {
			return undefined;
		}
		// A created row must not replace one that already exists.
		return {
			Put: {
				TableName: entry.tableName,
				Item: entry.current,
				ConditionExpression: "attribute_not_exists(#pk)",
				ExpressionAttributeNames: { "#pk": entry.keyField },
			},
		};
	}

	if (entry.current === null) {
		if (entry.pinnedFields.length === 0) {
			return { Delete: { TableName: entry.tableName, Key: entry.key } };
		}
		const condition = buildPinnedCondition(entry, entry.base);
		return {
			Delete: {
				TableName: entry.tableName,
				Key: entry.key,
				ConditionExpression: condition.expression,
				...buildAttributeInput(condition),
			},
		};
	}

	const condition = buildPinnedCondition(entry, entry.base);
	const current = entry.current;
	if (entry.replaced) {
		return {
			Put: {
				TableName: entry.tableName,
				Item: current,
				ConditionExpression: condition.expression,
				...buildAttributeInput(condition),
			},
		};
	}
	if (entry.assignedFields.length === 0) {
		if (entry.pinnedFields.length === 0) {
			return undefined;
		}
		return {
			ConditionCheck: {
				TableName: entry.tableName,
				Key: entry.key,
				ConditionExpression: condition.expression,
				...buildAttributeInput(condition),
			},
		};
	}
	// Each assigned attribute is written as the whole value it has in the
	// final image, or removed when that image no longer has it. Without the
	// existence check an update of a row that was deleted in the meantime
	// would create a partial row holding only the updated attributes.
	const update = buildUpdateExpression(
		Object.fromEntries(
			entry.assignedFields.map((field) => [field, current[field]]),
		),
	);
	return {
		Update: {
			TableName: entry.tableName,
			Key: entry.key,
			UpdateExpression: update.updateExpression,
			ConditionExpression: condition.expression,
			...buildAttributeInput({
				names: { ...update.expressionAttributeNames, ...condition.names },
				values: { ...update.expressionAttributeValues, ...condition.values },
			}),
		},
	};
};

export const executeTransaction = async (props: {
	documentClient: DynamoDBDocumentClient;
	state: DynamoDBTransactionState;
}): Promise<void> => {
	const { documentClient, state } = props;
	const transactItems = state.items
		.map((entry) => buildTransactItem(entry))
		.filter(
			(item): item is Record<string, unknown> => item !== undefined,
		);
	if (transactItems.length === 0) {
		return;
	}
	// Counted here, over the operations actually sent: a row that was created
	// and deleted again, or left unchanged, takes no place in the request.
	if (transactItems.length > TRANSACTION_ITEM_LIMIT) {
		throw new DynamoDBAdapterError(
			"TRANSACTION_LIMIT",
			`DynamoDB transactions are limited to ${TRANSACTION_ITEM_LIMIT} items; this one writes ${transactItems.length}.`,
		);
	}

	await documentClient.send(
		new TransactWriteCommand({
			TransactItems: transactItems,
		}),
	);
};
