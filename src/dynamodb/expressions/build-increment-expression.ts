/**
 * @file Update expression builder for atomic counter mutations (incrementOne).
 *
 * Counters are advanced with `field = field + delta` arithmetic evaluated by
 * DynamoDB, so concurrent increments cannot lose updates. Better Auth treats a
 * counter that is null or absent as 0; DynamoDB arithmetic accepts a missing
 * attribute (through `if_not_exists`) but rejects a NULL-typed one, so the
 * expression is chosen from the row snapshot and guarded by the attribute
 * type it was chosen for.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

export type IncrementAssignments = {
	increment: Record<string, number>;
	set: Record<string, NativeAttributeValue>;
	/**
	 * Attributes to remove: index key attributes that are set to null, which
	 * DynamoDB cannot store in them.
	 */
	remove: string[];
};

export type IncrementExpression = {
	updateExpression: string;
	/**
	 * Conditions on the attribute type of each counter. They must hold for the
	 * update expression to be the right one for the stored value.
	 */
	counterConditions: string[];
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	/**
	 * The snapshot with the mutation applied.
	 */
	nextItem: Record<string, NativeAttributeValue>;
};

type ExpressionFragment = {
	assignment: string;
	condition?: string | undefined;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
	nextValue: NativeAttributeValue;
	field: string;
};

const ZERO_TOKEN = ":zero";
const NUMBER_TYPE_TOKEN = ":numberType";
const NULL_TYPE_TOKEN = ":nullType";

/**
 * Normalize the incrementOne payload: drop unassigned (`undefined`) set
 * values, and reject payloads DynamoDB cannot apply in one expression.
 */
export const resolveIncrementAssignments = (props: {
	increment: Record<string, number>;
	set?: Record<string, unknown> | undefined;
	indexKeyAttributes?: string[] | undefined;
}): IncrementAssignments => {
	const indexKeyAttributes = props.indexKeyAttributes ?? [];
	const assigned = Object.entries(props.set ?? {}).filter(
		([, value]) => value !== undefined,
	);
	const isRemoval = ([field, value]: [string, unknown]): boolean => {
		if (value !== null) {
			return false;
		}
		return indexKeyAttributes.includes(field);
	};
	const remove = assigned.filter(isRemoval).map(([field]) => field);
	const set = assigned
		.filter((entry) => !isRemoval(entry))
		.reduce<Record<string, NativeAttributeValue>>(
			(acc, [field, value]) => ({
				...acc,
				[field]: value as NativeAttributeValue,
			}),
			{},
		);

	for (const [field, delta] of Object.entries(props.increment)) {
		if (typeof delta !== "number" || !Number.isFinite(delta)) {
			throw new DynamoDBAdapterError(
				"INVALID_UPDATE",
				`incrementOne requires a finite numeric delta for "${field}".`,
			);
		}
		if (field in set || remove.includes(field)) {
			throw new DynamoDBAdapterError(
				"INVALID_UPDATE",
				`incrementOne cannot both increment and set "${field}".`,
			);
		}
	}

	return { increment: { ...props.increment }, set, remove };
};

const buildCounterFragment = (props: {
	field: string;
	delta: number;
	index: number;
	current: NativeAttributeValue | undefined;
}): ExpressionFragment => {
	const nameToken = `#inc${props.index}`;
	const deltaToken = `:inc${props.index}`;
	const expressionAttributeNames = { [nameToken]: props.field };

	if (props.current === null) {
		return {
			field: props.field,
			assignment: `${nameToken} = ${deltaToken}`,
			condition: `attribute_type(${nameToken}, ${NULL_TYPE_TOKEN})`,
			expressionAttributeNames,
			expressionAttributeValues: {
				[deltaToken]: props.delta,
				[NULL_TYPE_TOKEN]: "NULL",
			},
			nextValue: props.delta,
		};
	}

	if (props.current === undefined || typeof props.current === "number") {
		return {
			field: props.field,
			assignment: `${nameToken} = if_not_exists(${nameToken}, ${ZERO_TOKEN}) + ${deltaToken}`,
			condition: `(attribute_not_exists(${nameToken}) OR attribute_type(${nameToken}, ${NUMBER_TYPE_TOKEN}))`,
			expressionAttributeNames,
			expressionAttributeValues: {
				[deltaToken]: props.delta,
				[ZERO_TOKEN]: 0,
				[NUMBER_TYPE_TOKEN]: "N",
			},
			nextValue: (props.current ?? 0) + props.delta,
		};
	}

	throw new DynamoDBAdapterError(
		"INVALID_UPDATE",
		`incrementOne requires "${props.field}" to hold a number or null.`,
	);
};

const buildSetFragment = (props: {
	field: string;
	value: NativeAttributeValue;
	index: number;
}): ExpressionFragment => {
	const nameToken = `#set${props.index}`;
	const valueToken = `:set${props.index}`;
	return {
		field: props.field,
		assignment: `${nameToken} = ${valueToken}`,
		expressionAttributeNames: { [nameToken]: props.field },
		expressionAttributeValues: { [valueToken]: props.value },
		nextValue: props.value,
	};
};

export const hasIncrementAssignments = (
	assignments: IncrementAssignments,
): boolean =>
	Object.keys(assignments.increment).length > 0 ||
	Object.keys(assignments.set).length > 0 ||
	assignments.remove.length > 0;

export const buildIncrementExpression = (props: {
	snapshot: Record<string, NativeAttributeValue>;
	assignments: IncrementAssignments;
}): IncrementExpression => {
	if (!hasIncrementAssignments(props.assignments)) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"incrementOne requires at least one increment or set assignment.",
		);
	}

	const fragments = [
		...Object.entries(props.assignments.increment).map(
			([field, delta], index) =>
				buildCounterFragment({
					field,
					delta,
					index,
					current: props.snapshot[field],
				}),
		),
		...Object.entries(props.assignments.set).map(([field, value], index) =>
			buildSetFragment({ field, value, index }),
		),
	];

	const removeTokens = props.assignments.remove.map((field, index) => ({
		token: `#rm${index}`,
		field,
	}));
	const clauses = [
		{ keyword: "SET", parts: fragments.map((fragment) => fragment.assignment) },
		{ keyword: "REMOVE", parts: removeTokens.map((entry) => entry.token) },
	].filter((clause) => clause.parts.length > 0);
	const withoutRemoved = (item: Record<string, NativeAttributeValue>) =>
		Object.fromEntries(
			Object.entries(item).filter(
				([field]) => !props.assignments.remove.includes(field),
			),
		);

	return {
		updateExpression: clauses
			.map((clause) => `${clause.keyword} ${clause.parts.join(", ")}`)
			.join(" "),
		counterConditions: fragments
			.map((fragment) => fragment.condition)
			.filter((condition): condition is string => condition !== undefined),
		expressionAttributeNames: fragments.reduce<Record<string, string>>(
			(acc, fragment) => ({ ...acc, ...fragment.expressionAttributeNames }),
			Object.fromEntries(removeTokens.map((entry) => [entry.token, entry.field])),
		),
		expressionAttributeValues: fragments.reduce<
			Record<string, NativeAttributeValue>
		>(
			(acc, fragment) => ({ ...acc, ...fragment.expressionAttributeValues }),
			{},
		),
		nextItem: fragments.reduce<Record<string, NativeAttributeValue>>(
			(acc, fragment) => ({ ...acc, [fragment.field]: fragment.nextValue }),
			withoutRemoved(props.snapshot),
		),
	};
};
