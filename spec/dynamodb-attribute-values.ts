/**
 * @file Typed DynamoDB attribute values for the in-memory fake.
 *
 * The fake stores and evaluates marshalled `AttributeValue`s, not the native
 * JavaScript values the document client accepts, because DynamoDB semantics
 * depend on the stored type: `N` compares numerically with exact decimal
 * precision, `S` compares by UTF-8 byte order (= code point order, not the
 * UTF-16 order of `<` on JS strings), sets are unordered, and so on. Every
 * rule here was checked against DynamoDB Local by
 * `spec/stateful-document-client.spec.ts`.
 */
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { unsupported, validationError } from "./dynamodb-fake-errors";

export type AttributeMap = Record<string, AttributeValue>;

export type AttributeTypeName =
	| "S"
	| "N"
	| "B"
	| "BOOL"
	| "NULL"
	| "M"
	| "L"
	| "SS"
	| "NS"
	| "BS";

export const ATTRIBUTE_TYPE_NAMES: readonly AttributeTypeName[] = [
	"S",
	"N",
	"B",
	"BOOL",
	"NULL",
	"M",
	"L",
	"SS",
	"NS",
	"BS",
];

export const isAttributeTypeName = (value: string): value is AttributeTypeName =>
	ATTRIBUTE_TYPE_NAMES.some((name) => name === value);

export const attributeTypeOf = (value: AttributeValue): AttributeTypeName => {
	if (value.S !== undefined) {
		return "S";
	}
	if (value.N !== undefined) {
		return "N";
	}
	if (value.B !== undefined) {
		return "B";
	}
	if (value.BOOL !== undefined) {
		return "BOOL";
	}
	if (value.NULL !== undefined) {
		return "NULL";
	}
	if (value.M !== undefined) {
		return "M";
	}
	if (value.L !== undefined) {
		return "L";
	}
	if (value.SS !== undefined) {
		return "SS";
	}
	if (value.NS !== undefined) {
		return "NS";
	}
	if (value.BS !== undefined) {
		return "BS";
	}
	throw unsupported(`attribute value without a known type: ${JSON.stringify(value)}`);
};

// ---------------------------------------------------------------------------
// Numbers: exact decimals (DynamoDB keeps up to 38 significant digits).
// ---------------------------------------------------------------------------

export type Decimal = {
	/** The value is `unscaled * 10^-scale`. */
	unscaled: bigint;
	scale: number;
};

const NUMBER_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export const parseDecimal = (text: string): Decimal => {
	const match = NUMBER_PATTERN.exec(text.trim());
	if (!match) {
		throw validationError(
			`A value provided cannot be converted into a number: ${text}`,
		);
	}
	const sign = match[1] === "-" ? "-" : "";
	const integerDigits = match[2] ?? "";
	const fractionDigits = match[3] ?? "";
	if (integerDigits.length + fractionDigits.length === 0) {
		throw validationError(
			`A value provided cannot be converted into a number: ${text}`,
		);
	}
	const exponent = Number(match[4] ?? "0");
	return {
		unscaled: BigInt(`${sign}${integerDigits}${fractionDigits}`),
		scale: fractionDigits.length - exponent,
	};
};

const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);

const alignDecimals = (
	left: Decimal,
	right: Decimal,
): { left: bigint; right: bigint; scale: number } => {
	const scale = Math.max(left.scale, right.scale);
	return {
		left: left.unscaled * pow10(scale - left.scale),
		right: right.unscaled * pow10(scale - right.scale),
		scale,
	};
};

export const compareDecimals = (left: Decimal, right: Decimal): number => {
	const aligned = alignDecimals(left, right);
	if (aligned.left < aligned.right) {
		return -1;
	}
	if (aligned.left > aligned.right) {
		return 1;
	}
	return 0;
};

/**
 * Sum with the scale rule of Java's `BigDecimal.add` (the larger scale), which
 * is what DynamoDB Local returns: `1.5 - 1.5` is stored as `0.0`.
 */
export const addDecimals = (left: Decimal, right: Decimal): Decimal => {
	const aligned = alignDecimals(left, right);
	return { unscaled: aligned.left + aligned.right, scale: aligned.scale };
};

export const negateDecimal = (value: Decimal): Decimal => ({
	unscaled: -value.unscaled,
	scale: value.scale,
});

export const formatDecimal = (value: Decimal): string => {
	if (value.scale <= 0) {
		return (value.unscaled * pow10(-value.scale)).toString();
	}
	const negative = value.unscaled < 0n;
	const magnitude = negative ? -value.unscaled : value.unscaled;
	const digits = magnitude.toString().padStart(value.scale + 1, "0");
	const integerPart = digits.slice(0, digits.length - value.scale);
	const fractionPart = digits.slice(digits.length - value.scale);
	return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
};

/**
 * Significant digits and decimal exponent of a non-zero decimal, with the
 * trailing zeros of the unscaled value removed.
 */
const describeMagnitude = (
	value: Decimal,
): { digits: string; exponent: number } | undefined => {
	if (value.unscaled === 0n) {
		return undefined;
	}
	const raw = (value.unscaled < 0n ? -value.unscaled : value.unscaled).toString();
	const trimmed = raw.replace(/0+$/, "");
	const removedZeros = raw.length - trimmed.length;
	// value = trimmed * 10^(removedZeros - scale); exponent of the leading digit:
	const exponent = trimmed.length - 1 + removedZeros - value.scale;
	return { digits: trimmed, exponent };
};

/**
 * DynamoDB numbers hold up to 38 significant digits, in the magnitude range
 * 1E-130 to 9.9999999999999999999999999999999999999E+125.
 */
export const assertStorableNumber = (text: string): void => {
	const magnitude = describeMagnitude(parseDecimal(text));
	if (!magnitude) {
		return;
	}
	if (magnitude.digits.length > 38) {
		throw validationError(
			"Attempting to store more than 38 significant digits in a Number",
		);
	}
	if (magnitude.exponent > 125) {
		throw validationError("Number overflow. Attempting to store a number with magnitude larger than supported range");
	}
	if (magnitude.exponent < -130) {
		throw validationError("Number underflow. Attempting to store a number with magnitude smaller than supported range");
	}
};

/** A canonical spelling, so that numerically equal key values collide. */
export const canonicalNumber = (text: string): string => {
	const magnitude = describeMagnitude(parseDecimal(text));
	if (!magnitude) {
		return "0";
	}
	const sign = parseDecimal(text).unscaled < 0n ? "-" : "";
	return `${sign}${magnitude.digits}e${magnitude.exponent}`;
};

// ---------------------------------------------------------------------------
// Strings and binaries.
// ---------------------------------------------------------------------------

/**
 * DynamoDB orders strings by their UTF-8 bytes, which is code point order.
 * JavaScript's `<` compares UTF-16 code units and disagrees for characters
 * outside the Basic Multilingual Plane.
 */
export const compareStrings = (left: string, right: string): number => {
	const leftPoints = Array.from(left, (char) => char.codePointAt(0) ?? 0);
	const rightPoints = Array.from(right, (char) => char.codePointAt(0) ?? 0);
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (const index of Array.from({ length }, (_, i) => i)) {
		if (leftPoints[index] !== rightPoints[index]) {
			return leftPoints[index] < rightPoints[index] ? -1 : 1;
		}
	}
	return leftPoints.length - rightPoints.length;
};

export const compareBinaries = (left: Uint8Array, right: Uint8Array): number => {
	const length = Math.min(left.length, right.length);
	for (const index of Array.from({ length }, (_, i) => i)) {
		if (left[index] !== right[index]) {
			return left[index] < right[index] ? -1 : 1;
		}
	}
	return left.length - right.length;
};

const binaryStartsWith = (value: Uint8Array, prefix: Uint8Array): boolean =>
	prefix.length <= value.length &&
	compareBinaries(value.subarray(0, prefix.length), prefix) === 0;

const binaryIncludes = (value: Uint8Array, part: Uint8Array): boolean =>
	Array.from({ length: value.length - part.length + 1 }, (_, i) => i).some(
		(offset) =>
			compareBinaries(value.subarray(offset, offset + part.length), part) === 0,
	);

const hexOf = (value: Uint8Array): string =>
	Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

// ---------------------------------------------------------------------------
// Normalisation of values entering the fake.
// ---------------------------------------------------------------------------

const toBytes = (value: unknown): Uint8Array => {
	if (value instanceof Uint8Array) {
		return new Uint8Array(value);
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value.slice(0));
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(
			value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
		);
	}
	throw unsupported(`binary attribute value of this kind: ${String(value)}`);
};

const assertDistinct = (members: string[], typeName: string): void => {
	if (new Set(members).size !== members.length) {
		throw validationError(
			`One or more parameter values were invalid: Input collection contains duplicates for ${typeName}`,
		);
	}
};

const assertNonEmptySet = (size: number, typeName: string): void => {
	if (size === 0) {
		throw validationError(
			`One or more parameter values were invalid: An ${typeName} may not be empty`,
		);
	}
};

/**
 * Validate a request value the way DynamoDB does and return a private deep
 * copy (later mutation of the caller's objects must not reach the store).
 */
export const normalizeAttributeValue = (value: AttributeValue): AttributeValue => {
	const type = attributeTypeOf(value);
	if (type === "S") {
		return { S: value.S ?? "" };
	}
	if (type === "N") {
		const text = value.N ?? "";
		assertStorableNumber(text);
		return { N: text };
	}
	if (type === "B") {
		return { B: toBytes(value.B) };
	}
	if (type === "BOOL") {
		return { BOOL: value.BOOL === true };
	}
	if (type === "NULL") {
		return { NULL: true };
	}
	if (type === "M") {
		return { M: normalizeAttributeMap(value.M ?? {}) };
	}
	if (type === "L") {
		return { L: (value.L ?? []).map(normalizeAttributeValue) };
	}
	if (type === "SS") {
		const members = [...(value.SS ?? [])];
		assertNonEmptySet(members.length, "string set ");
		assertDistinct(members, "SS");
		return { SS: members };
	}
	if (type === "NS") {
		const members = [...(value.NS ?? [])];
		assertNonEmptySet(members.length, "number set ");
		members.forEach(assertStorableNumber);
		assertDistinct(members.map(canonicalNumber), "NS");
		return { NS: members };
	}
	const members = (value.BS ?? []).map(toBytes);
	assertNonEmptySet(members.length, "binary set ");
	assertDistinct(members.map(hexOf), "BS");
	return { BS: members };
};

export const normalizeAttributeMap = (map: AttributeMap): AttributeMap =>
	Object.fromEntries(
		Object.entries(map).map(([name, value]) => [name, normalizeAttributeValue(value)]),
	);

export const cloneAttributeValue = (value: AttributeValue): AttributeValue =>
	normalizeAttributeValue(value);

export const cloneAttributeMap = (map: AttributeMap): AttributeMap =>
	normalizeAttributeMap(map);

// ---------------------------------------------------------------------------
// Equality, ordering, and functions.
// ---------------------------------------------------------------------------

const sameMembers = <T>(
	left: T[],
	right: T[],
	equals: (a: T, b: T) => boolean,
): boolean => {
	if (left.length !== right.length) {
		return false;
	}
	if (!left.every((member) => right.some((candidate) => equals(member, candidate)))) {
		return false;
	}
	return right.every((member) => left.some((candidate) => equals(member, candidate)));
};

const numbersEqual = (left: string, right: string): boolean =>
	compareDecimals(parseDecimal(left), parseDecimal(right)) === 0;

const binariesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
	compareBinaries(left, right) === 0;

/**
 * Deep equality as the `=` comparator evaluates it: types must match, numbers
 * compare by value (`1` = `1.0`), sets ignore member order.
 */
export const attributeValuesEqual = (
	left: AttributeValue,
	right: AttributeValue,
): boolean => {
	const type = attributeTypeOf(left);
	if (type !== attributeTypeOf(right)) {
		return false;
	}
	if (type === "S") {
		return left.S === right.S;
	}
	if (type === "N") {
		return numbersEqual(left.N ?? "", right.N ?? "");
	}
	if (type === "B") {
		return binariesEqual(toBytes(left.B), toBytes(right.B));
	}
	if (type === "BOOL") {
		return left.BOOL === right.BOOL;
	}
	if (type === "NULL") {
		return true;
	}
	if (type === "M") {
		const leftMap = left.M ?? {};
		const rightMap = right.M ?? {};
		const keys = Object.keys(leftMap);
		if (keys.length !== Object.keys(rightMap).length) {
			return false;
		}
		return keys.every((key) => {
			const other = rightMap[key];
			if (other === undefined) {
				return false;
			}
			return attributeValuesEqual(leftMap[key], other);
		});
	}
	if (type === "L") {
		const leftList = left.L ?? [];
		const rightList = right.L ?? [];
		if (leftList.length !== rightList.length) {
			return false;
		}
		return leftList.every((entry, index) =>
			attributeValuesEqual(entry, rightList[index]),
		);
	}
	if (type === "SS") {
		return sameMembers(left.SS ?? [], right.SS ?? [], (a, b) => a === b);
	}
	if (type === "NS") {
		return sameMembers(left.NS ?? [], right.NS ?? [], numbersEqual);
	}
	return sameMembers(
		(left.BS ?? []).map(toBytes),
		(right.BS ?? []).map(toBytes),
		binariesEqual,
	);
};

/** The types the ordering comparators (`<`, `BETWEEN`, ...) accept. */
export const isOrderedType = (type: AttributeTypeName): boolean =>
	type === "S" || type === "N" || type === "B";

/**
 * Order two scalar values of the same ordered type; `undefined` when the
 * values are not comparable (different or unordered types).
 */
export const compareOrderedValues = (
	left: AttributeValue,
	right: AttributeValue,
): number | undefined => {
	const type = attributeTypeOf(left);
	if (type !== attributeTypeOf(right) || !isOrderedType(type)) {
		return undefined;
	}
	if (type === "S") {
		return compareStrings(left.S ?? "", right.S ?? "");
	}
	if (type === "N") {
		return compareDecimals(parseDecimal(left.N ?? ""), parseDecimal(right.N ?? ""));
	}
	return compareBinaries(toBytes(left.B), toBytes(right.B));
};

/**
 * `size()`: string length in UTF-16 code units (DynamoDB Local reports 3 for
 * "😀é"), bytes of a binary, members of a set, list, or map. Other types have
 * no size and make the comparison false.
 */
export const sizeOf = (value: AttributeValue): number | undefined => {
	const type = attributeTypeOf(value);
	if (type === "S") {
		return (value.S ?? "").length;
	}
	if (type === "B") {
		return toBytes(value.B).length;
	}
	if (type === "SS") {
		return (value.SS ?? []).length;
	}
	if (type === "NS") {
		return (value.NS ?? []).length;
	}
	if (type === "BS") {
		return (value.BS ?? []).length;
	}
	if (type === "L") {
		return (value.L ?? []).length;
	}
	if (type === "M") {
		return Object.keys(value.M ?? {}).length;
	}
	return undefined;
};

export const beginsWith = (value: AttributeValue, prefix: AttributeValue): boolean => {
	const type = attributeTypeOf(value);
	if (type !== attributeTypeOf(prefix)) {
		return false;
	}
	if (type === "S") {
		return (value.S ?? "").startsWith(prefix.S ?? "");
	}
	if (type === "B") {
		return binaryStartsWith(toBytes(value.B), toBytes(prefix.B));
	}
	return false;
};

/**
 * `contains()`: substring of a string or binary, member of a set of the
 * operand's scalar type, or element of a list.
 */
export const containsValue = (
	container: AttributeValue,
	operand: AttributeValue,
): boolean => {
	const containerType = attributeTypeOf(container);
	const operandType = attributeTypeOf(operand);
	if (containerType === "S" && operandType === "S") {
		return (container.S ?? "").includes(operand.S ?? "");
	}
	if (containerType === "B" && operandType === "B") {
		return binaryIncludes(toBytes(container.B), toBytes(operand.B));
	}
	if (containerType === "SS" && operandType === "S") {
		return (container.SS ?? []).includes(operand.S ?? "");
	}
	if (containerType === "NS" && operandType === "N") {
		return (container.NS ?? []).some((member) => numbersEqual(member, operand.N ?? ""));
	}
	if (containerType === "BS" && operandType === "B") {
		const needle = toBytes(operand.B);
		return (container.BS ?? []).some((member) => binariesEqual(toBytes(member), needle));
	}
	if (containerType === "L") {
		return (container.L ?? []).some((element) => attributeValuesEqual(element, operand));
	}
	return false;
};

/**
 * A string that identifies a key attribute value: equal for values DynamoDB
 * treats as the same key (`1` and `1.0` are one number).
 */
export const keyValueFingerprint = (value: AttributeValue): string => {
	const type = attributeTypeOf(value);
	if (type === "S") {
		return `S:${value.S ?? ""}`;
	}
	if (type === "N") {
		return `N:${canonicalNumber(value.N ?? "")}`;
	}
	if (type === "B") {
		return `B:${hexOf(toBytes(value.B))}`;
	}
	throw validationError(
		"One or more parameter values were invalid: Key attributes must be of type S, N, or B",
	);
};

// ---------------------------------------------------------------------------
// Set arithmetic for ADD / DELETE.
// ---------------------------------------------------------------------------

export const isSetType = (type: AttributeTypeName): boolean =>
	type === "SS" || type === "NS" || type === "BS";

export const unionSets = (
	left: AttributeValue,
	right: AttributeValue,
): AttributeValue => {
	const type = attributeTypeOf(left);
	if (type === "SS") {
		const members = [...(left.SS ?? [])];
		(right.SS ?? []).forEach((member) => {
			if (!members.includes(member)) {
				members.push(member);
			}
		});
		return { SS: members };
	}
	if (type === "NS") {
		const members = [...(left.NS ?? [])];
		(right.NS ?? []).forEach((member) => {
			if (!members.some((existing) => numbersEqual(existing, member))) {
				members.push(member);
			}
		});
		return { NS: members };
	}
	const members = (left.BS ?? []).map(toBytes);
	(right.BS ?? []).map(toBytes).forEach((member) => {
		if (!members.some((existing) => binariesEqual(existing, member))) {
			members.push(member);
		}
	});
	return { BS: members };
};

/** Set difference; `undefined` when nothing is left (the attribute is removed). */
export const subtractSets = (
	left: AttributeValue,
	right: AttributeValue,
): AttributeValue | undefined => {
	const type = attributeTypeOf(left);
	if (type === "SS") {
		const removed = right.SS ?? [];
		const members = (left.SS ?? []).filter((member) => !removed.includes(member));
		return members.length === 0 ? undefined : { SS: members };
	}
	if (type === "NS") {
		const removed = right.NS ?? [];
		const members = (left.NS ?? []).filter(
			(member) => !removed.some((other) => numbersEqual(member, other)),
		);
		return members.length === 0 ? undefined : { NS: members };
	}
	const removed = (right.BS ?? []).map(toBytes);
	const members = (left.BS ?? [])
		.map(toBytes)
		.filter((member) => !removed.some((other) => binariesEqual(member, other)));
	return members.length === 0 ? undefined : { BS: members };
};
