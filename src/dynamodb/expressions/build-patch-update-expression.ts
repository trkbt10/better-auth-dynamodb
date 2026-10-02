/**
 * @file DynamoDB patch update expression builder.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import { DynamoDBAdapterError } from "../errors/errors";

type ExpressionEntry = {
	kind: "set" | "remove" | "noop";
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

// Every assigned value gets a placeholder of its own. Sharing one between
// equal-looking values would hand the string "5" and the number 5 the same
// placeholder, and one of the two attributes the wrong value.
const createValueKeySequence = (prefix: string): (() => string) => {
	const counter = { value: 0 };
	return (): string => {
		const key = `${prefix}${counter.value}`;
		counter.value += 1;
		return key;
	};
};

const isRemoved = (prev: unknown, next: unknown): boolean =>
	typeof prev !== "undefined" && typeof next === "undefined";

const isReplaced = (prev: unknown, next: unknown): boolean =>
	typeof prev !== typeof next;

const isUpdated = (prev: unknown, next: unknown): boolean =>
	typeof prev === typeof next;

const buildExpressionEntry = (props: {
	path: Array<string | number>;
	prev: unknown;
	next: unknown;
	makeNameKey: (seed: string) => string;
	makeValueKey: () => string;
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
	const resolvePathPrefix = (value: string): string => {
		if (value === "") {
			return "";
		}
		return ".";
	};
	const expressionKey = props.path.reduce<string>((acc, segment) => {
		if (typeof segment === "number") {
			return `${acc}[${segment}]`;
		}
		const prefix = resolvePathPrefix(acc);
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

	// A changed value is assigned as it is. A number is not turned into an
	// `ADD` of the difference to the row that was read: the update sets a
	// value, and a delta would add up with concurrent writes.
	if (isUpdated(props.prev, props.next) || isReplaced(props.prev, props.next)) {
		const valueKey = props.makeValueKey();
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

export type PatchUpdateExpression = {
	updateExpression: string;
	expressionAttributeNames: Record<string, string>;
	expressionAttributeValues: Record<string, NativeAttributeValue>;
};

/**
 * Build the update expression that turns `prev` into `next`, or `undefined`
 * when the two are already equal and there is nothing to write.
 */
export const resolvePatchUpdateExpression = (props: {
	prev: Record<string, unknown>;
	next: Record<string, unknown>;
}): PatchUpdateExpression | undefined => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Patch update requires explicit prev/next.",
		);
	}

	const changes = compareTwoObjects([], props.prev, props.next);
	if (changes.length === 0) {
		return undefined;
	}

	const makeNameKey = uniqueAttributeKeyCreator("a");
	const makeValueKey = createValueKeySequence("v");
	const entries = changes.map((change) =>
		buildExpressionEntry({
			...change,
			makeNameKey,
			makeValueKey,
		}),
	);
	const expression = concatExpressions(entries);

	if (!expression.updateExpression) {
		return undefined;
	}

	return {
		updateExpression: expression.updateExpression,
		expressionAttributeNames: expression.attributeNames,
		expressionAttributeValues: expression.attributeValues,
	};
};

export const buildPatchUpdateExpression = (props: {
	prev: Record<string, unknown>;
	next: Record<string, unknown>;
}): PatchUpdateExpression => {
	const expression = resolvePatchUpdateExpression(props);
	if (!expression) {
		throw new DynamoDBAdapterError(
			"INVALID_UPDATE",
			"Update payload must include at least one defined value.",
		);
	}
	return expression;
};
