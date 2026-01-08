/**
 * @file DynamoDB patch update expression builder.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

type ExpressionEntry = {
	kind: "add" | "set" | "remove" | "noop";
	expression: string;
	attributeNames: Record<string, string>;
	attributeValues: Record<string, NativeAttributeValue>;
};

type CompareEntry = {
	path: Array<string | number>;
	prev: unknown;
	next: unknown;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const compareTwoObjects = (
	path: Array<string | number>,
	prev: unknown,
	next: unknown,
): CompareEntry[] => {
	if (Object.is(prev, next)) {
		return [];
	}

	if (typeof prev !== typeof next) {
		return [{ path, prev, next }];
	}

	if (Array.isArray(prev) && Array.isArray(next)) {
		const maxLength = Math.max(prev.length, next.length);
		return Array.from({ length: maxLength }, (_, index) => {
			const prevValue = prev[index];
			const nextValue = next[index];
			return compareTwoObjects([...path, index], prevValue, nextValue);
		}).flat();
	}

	if (isObject(prev) && isObject(next)) {
		const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
		return Array.from(keys).flatMap((key) =>
			compareTwoObjects([...path, key], prev[key], next[key]),
		);
	}

	return [{ path, prev, next }];
};

const uniqueAttributeKeyCreator = (prefix: string): ((seed: string) => string) => {
	const attributeKeyMap = new Map<string, string>();
	const counter = { value: 0 };
	return (seed: string): string => {
		const existing = attributeKeyMap.get(seed);
		if (existing) {
			return existing;
		}
		const generatedKey = `${prefix}${counter.value}`;
		counter.value += 1;
		attributeKeyMap.set(seed, generatedKey);
		return generatedKey;
	};
};

const isRemoved = (prev: unknown, next: unknown): boolean =>
	typeof prev !== "undefined" && typeof next === "undefined";

const isComputation = (prev: unknown, next: unknown): prev is number =>
	typeof prev === "number" && typeof next === "number";

const isReplaced = (prev: unknown, next: unknown): boolean =>
	typeof prev !== typeof next;

const isUpdated = (prev: unknown, next: unknown): boolean =>
	typeof prev === typeof next;

const toValueSeed = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch (error) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Failed to serialize update value.",
		);
	}
};

const buildExpressionEntry = (props: {
	path: Array<string | number>;
	prev: unknown;
	next: unknown;
	makeNameKey: (seed: string) => string;
	makeValueKey: (seed: string) => string;
}): ExpressionEntry => {
	if (Object.is(props.prev, props.next)) {
		return {
			kind: "noop",
			expression: "",
			attributeNames: {},
			attributeValues: {},
		};
	}

	const filteredPath = props.path.filter(
		(key): key is string => typeof key === "string",
	);
	const attributeKeys = filteredPath.map((segment) =>
		props.makeNameKey(segment),
	);
	const expressionKey = props.path.reduce<string>((acc, segment) => {
		if (typeof segment === "number") {
			return `${acc}[${segment}]`;
		}
		const prefix = acc === "" ? "" : ".";
		return `${acc}${prefix}#${props.makeNameKey(segment)}`;
	}, "");
	const attributeNameEntries = attributeKeys.map((key, index) => [
		`#${key}`,
		filteredPath[index].toString(),
	]);
	const attributeNames = Object.fromEntries(attributeNameEntries);

	if (isRemoved(props.prev, props.next)) {
		return {
			kind: "remove",
			expression: expressionKey,
			attributeNames,
			attributeValues: {},
		};
	}

	if (isComputation(props.prev, props.next)) {
		const gap = (props.next as number) - props.prev;
		const valueKey = props.makeValueKey(toValueSeed(gap));
		return {
			kind: "add",
			expression: `${expressionKey} :${valueKey}`,
			attributeNames,
			attributeValues: {
				[`:${valueKey}`]: gap as NativeAttributeValue,
			},
		};
	}

	if (isUpdated(props.prev, props.next) || isReplaced(props.prev, props.next)) {
		const valueKey = props.makeValueKey(toValueSeed(props.next));
		return {
			kind: "set",
			expression: `${expressionKey} = :${valueKey}`,
			attributeNames,
			attributeValues: {
				[`:${valueKey}`]: props.next as NativeAttributeValue,
			},
		};
	}

	return {
		kind: "noop",
		expression: "",
		attributeNames: {},
		attributeValues: {},
	};
};

const concatExpressions = (entries: ExpressionEntry[]) => {
	const grouped = entries.reduce<Record<string, ExpressionEntry[]>>(
		(acc, entry) => {
			const existing = acc[entry.kind] ?? [];
			acc[entry.kind] = [...existing, entry];
			return acc;
		},
		{},
	);

	const merged = Object.entries(grouped).reduce(
		(acc, [kind, expressions]) => {
			if (kind === "noop") {
				return acc;
			}
			const expression = expressions.map((exp) => exp.expression).join(",");
			return {
				updateExpression: [...acc.updateExpression, `${kind.toUpperCase()} ${expression}`],
				attributeNames: expressions.reduce(
					(names, exp) => ({ ...names, ...exp.attributeNames }),
					acc.attributeNames,
				),
				attributeValues: expressions.reduce(
					(values, exp) => ({ ...values, ...exp.attributeValues }),
					acc.attributeValues,
				),
			};
		},
		{
			updateExpression: [] as string[],
			attributeNames: {} as Record<string, string>,
			attributeValues: {} as Record<string, NativeAttributeValue>,
		},
	);

	return {
		updateExpression: merged.updateExpression.join(" "),
		attributeNames: merged.attributeNames,
		attributeValues: merged.attributeValues,
	};
};

export const buildPatchUpdateExpression = (props: {
	prev: Record<string, unknown>;
	next: Record<string, unknown>;
}): {
	updateExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
} => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Patch update requires explicit prev/next.",
		);
	}

	const changes = compareTwoObjects([], props.prev, props.next);
	if (changes.length === 0) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Update payload must include at least one defined value.",
		);
	}

	const makeNameKey = uniqueAttributeKeyCreator("a");
	const makeValueKey = uniqueAttributeKeyCreator("v");
	const entries = changes.map((change) =>
		buildExpressionEntry({
			...change,
			makeNameKey,
			makeValueKey,
		}),
	);
	const expression = concatExpressions(entries);

	if (!expression.updateExpression) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Update payload must include at least one defined value.",
		);
	}

	return {
		updateExpression: expression.updateExpression,
		expressionAttributeNames: expression.attributeNames,
		expressionAttributeValues: expression.attributeValues,
	};
};
