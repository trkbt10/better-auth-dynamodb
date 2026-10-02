/**
 * @file Tokenizer, recursive-descent parser, and evaluator for the DynamoDB
 * expression language, used by the in-memory DynamoDB fake.
 *
 * Covered:
 * - condition / filter / key-condition expressions: `AND`, `OR`, `NOT`,
 *   parentheses, `= <> < <= > >=`, `IN (...)`, `BETWEEN ... AND ...`,
 *   `attribute_exists`, `attribute_not_exists`, `attribute_type`,
 *   `begins_with`, `contains`, `size`;
 * - update expressions: `SET` (value, `a + b`, `a - b`, `if_not_exists`,
 *   `list_append`), `REMOVE`, `ADD` (numbers and sets), `DELETE` (sets);
 * - operands: `#name` placeholders, plain attribute names (rejected when they
 *   are reserved words), nested paths with `.` and `[n]`, `:value`
 *   placeholders.
 *
 * Request-level validation follows DynamoDB: undefined or unused
 * `ExpressionAttributeNames` / `ExpressionAttributeValues` entries, empty
 * maps, static operand type errors, identical operands, and overlapping
 * update paths are ValidationExceptions. A failing runtime operation (for
 * example arithmetic on a missing or NULL attribute) is a ValidationException
 * raised while the update is applied. The semantics were taken from DynamoDB
 * Local and are pinned by the differential spec
 * `spec/stateful-document-client.spec.ts`.
 *
 * Out of scope (the fake throws FakeDynamoDBUnsupportedError when asked):
 * ProjectionExpression and the legacy (pre-expression) request parameters.
 */
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import {
	addDecimals,
	assertStorableNumber,
	attributeTypeOf,
	attributeValuesEqual,
	beginsWith,
	cloneAttributeMap,
	cloneAttributeValue,
	compareOrderedValues,
	containsValue,
	formatDecimal,
	isAttributeTypeName,
	isOrderedType,
	isSetType,
	negateDecimal,
	normalizeAttributeValue,
	parseDecimal,
	sizeOf,
	subtractSets,
	unionSets,
	type AttributeMap,
	type AttributeTypeName,
} from "./dynamodb-attribute-values";
import { validationError } from "./dynamodb-fake-errors";
import { isReservedWord } from "./dynamodb-reserved-words";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type PunctuationText =
	| "("
	| ")"
	| "["
	| "]"
	| ","
	| "."
	| "="
	| "<>"
	| "<"
	| "<="
	| ">"
	| ">="
	| "+"
	| "-";

type Token =
	| { kind: "name"; text: string; position: number }
	| { kind: "value"; text: string; position: number }
	| { kind: "identifier"; text: string; position: number }
	| { kind: "integer"; text: string; position: number }
	| { kind: "punctuation"; text: PunctuationText; position: number }
	| { kind: "end"; text: "<EOF>"; position: number };

const isLetter = (char: string): boolean => /^[A-Za-z]$/.test(char);
const isDigit = (char: string): boolean => /^[0-9]$/.test(char);
const isWordChar = (char: string): boolean => /^[A-Za-z0-9_]$/.test(char);
const isWhitespace = (char: string): boolean => /^\s$/.test(char);

const TWO_CHAR_PUNCTUATION: readonly PunctuationText[] = ["<>", "<=", ">="];
const ONE_CHAR_PUNCTUATION: readonly PunctuationText[] = [
	"(",
	")",
	"[",
	"]",
	",",
	".",
	"=",
	"<",
	">",
	"+",
	"-",
];

const syntaxError = (label: string, source: string, token: { text: string; position: number }) =>
	validationError(
		`Invalid ${label}: Syntax error; token: "${token.text}", near: "${source.slice(
			Math.max(0, token.position - 8),
			token.position + token.text.length + 8,
		)}"`,
	);

const readWord = (source: string, start: number): string => {
	const end = { value: start };
	while (end.value < source.length && isWordChar(source[end.value])) {
		end.value += 1;
	}
	return source.slice(start, end.value);
};

const matchPunctuation = (source: string, position: number): PunctuationText | undefined => {
	const two = TWO_CHAR_PUNCTUATION.find((text) => source.startsWith(text, position));
	if (two) {
		return two;
	}
	return ONE_CHAR_PUNCTUATION.find((text) => source.startsWith(text, position));
};

const readToken = (label: string, source: string, position: number): Token => {
	const char = source[position];
	if (char === "#" || char === ":") {
		const word = readWord(source, position + 1);
		if (word.length === 0) {
			throw syntaxError(label, source, { text: char, position });
		}
		const text = `${char}${word}`;
		return char === "#" ? { kind: "name", text, position } : { kind: "value", text, position };
	}
	if (isLetter(char)) {
		return { kind: "identifier", text: readWord(source, position), position };
	}
	if (isDigit(char)) {
		const end = { value: position };
		while (end.value < source.length && isDigit(source[end.value])) {
			end.value += 1;
		}
		return { kind: "integer", text: source.slice(position, end.value), position };
	}
	const punctuation = matchPunctuation(source, position);
	if (!punctuation) {
		throw syntaxError(label, source, { text: char, position });
	}
	return { kind: "punctuation", text: punctuation, position };
};

const tokenize = (label: string, source: string): Token[] => {
	const tokens: Token[] = [];
	const cursor = { position: 0 };
	while (cursor.position < source.length) {
		if (isWhitespace(source[cursor.position])) {
			cursor.position += 1;
			continue;
		}
		const token = readToken(label, source, cursor.position);
		tokens.push(token);
		cursor.position += token.text.length;
	}
	tokens.push({ kind: "end", text: "<EOF>", position: source.length });
	return tokens;
};

// ---------------------------------------------------------------------------
// Request context: placeholder resolution and usage tracking.
// ---------------------------------------------------------------------------

const NAME_PLACEHOLDER = /^#[A-Za-z0-9_]+$/;
const VALUE_PLACEHOLDER = /^:[A-Za-z0-9_]+$/;

/**
 * The `ExpressionAttributeNames` / `ExpressionAttributeValues` of one request,
 * shared by all expressions of that request so that unused entries can be
 * detected across them.
 */
export type ExpressionContext = {
	names: Record<string, string>;
	values: AttributeMap;
	usedNames: Set<string>;
	usedValues: Set<string>;
};

export const createExpressionContext = (props: {
	names: Record<string, string> | undefined;
	values: AttributeMap | undefined;
}): ExpressionContext => {
	if (props.names !== undefined && Object.keys(props.names).length === 0) {
		throw validationError("ExpressionAttributeNames must not be empty");
	}
	if (props.values !== undefined && Object.keys(props.values).length === 0) {
		throw validationError("ExpressionAttributeValues must not be empty");
	}
	const names = props.names ?? {};
	Object.keys(names).forEach((key) => {
		if (!NAME_PLACEHOLDER.test(key)) {
			throw validationError(`ExpressionAttributeNames contains invalid key: Syntax error; key: "${key}"`);
		}
	});
	const values = Object.fromEntries(
		Object.entries(props.values ?? {}).map(([key, value]) => {
			if (!VALUE_PLACEHOLDER.test(key)) {
				throw validationError(`ExpressionAttributeValues contains invalid key: Syntax error; key: "${key}"`);
			}
			return [key, normalizeAttributeValue(value)];
		}),
	);
	return { names, values, usedNames: new Set(), usedValues: new Set() };
};

/**
 * Raise the ValidationException DynamoDB returns for placeholders that no
 * expression of the request used. Call after every expression is compiled.
 */
export const assertAllPlaceholdersUsed = (context: ExpressionContext): void => {
	const unusedNames = Object.keys(context.names).filter((key) => !context.usedNames.has(key));
	if (unusedNames.length > 0) {
		throw validationError(
			`Value provided in ExpressionAttributeNames unused in expressions: keys: {${unusedNames.join(", ")}}`,
		);
	}
	const unusedValues = Object.keys(context.values).filter((key) => !context.usedValues.has(key));
	if (unusedValues.length > 0) {
		throw validationError(
			`Value provided in ExpressionAttributeValues unused in expressions: keys: {${unusedValues.join(", ")}}`,
		);
	}
};

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type PathElement =
	| { kind: "attribute"; name: string }
	| { kind: "index"; index: number };

export type DocumentPath = PathElement[];

export type Operand =
	| { kind: "path"; path: DocumentPath }
	| { kind: "value"; placeholder: string; value: AttributeValue }
	| { kind: "size"; operand: Operand };

export type Comparator = "=" | "<>" | "<" | "<=" | ">" | ">=";

export type Condition =
	| { kind: "and"; left: Condition; right: Condition }
	| { kind: "or"; left: Condition; right: Condition }
	| { kind: "not"; condition: Condition }
	| { kind: "group"; condition: Condition }
	| { kind: "compare"; comparator: Comparator; left: Operand; right: Operand }
	| { kind: "between"; operand: Operand; lower: Operand; upper: Operand }
	| { kind: "in"; operand: Operand; candidates: Operand[] }
	| { kind: "attribute_exists"; path: DocumentPath }
	| { kind: "attribute_not_exists"; path: DocumentPath }
	| { kind: "attribute_type"; path: DocumentPath; type: AttributeTypeName }
	| { kind: "begins_with"; operand: Operand; prefix: Operand }
	| { kind: "contains"; operand: Operand; part: Operand };

export type UpdateOperand =
	| { kind: "path"; path: DocumentPath }
	| { kind: "value"; placeholder: string; value: AttributeValue }
	| { kind: "if_not_exists"; path: DocumentPath; fallback: UpdateOperand }
	| { kind: "list_append"; left: UpdateOperand; right: UpdateOperand };

export type SetValue =
	| UpdateOperand
	| { kind: "plus"; left: UpdateOperand; right: UpdateOperand }
	| { kind: "minus"; left: UpdateOperand; right: UpdateOperand };

export type UpdateAction =
	| { kind: "set"; path: DocumentPath; value: SetValue }
	| { kind: "remove"; path: DocumentPath }
	| { kind: "add"; path: DocumentPath; value: AttributeValue }
	| { kind: "delete"; path: DocumentPath; value: AttributeValue };

const CONDITION_FUNCTIONS = [
	"attribute_exists",
	"attribute_not_exists",
	"attribute_type",
	"begins_with",
	"contains",
] as const;
const UPDATE_FUNCTIONS = ["if_not_exists", "list_append"] as const;
const OPERAND_FUNCTIONS = ["size"] as const;

type ConditionFunctionName = (typeof CONDITION_FUNCTIONS)[number];

const isConditionFunction = (name: string): name is ConditionFunctionName =>
	CONDITION_FUNCTIONS.some((candidate) => candidate === name);
const isUpdateFunction = (name: string): boolean =>
	UPDATE_FUNCTIONS.some((candidate) => candidate === name);
const isOperandFunction = (name: string): boolean =>
	OPERAND_FUNCTIONS.some((candidate) => candidate === name);

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type Parser = {
	label: string;
	source: string;
	tokens: Token[];
	cursor: { index: number };
	context: ExpressionContext;
};

const createParser = (label: string, source: string, context: ExpressionContext): Parser => {
	if (source.trim().length === 0) {
		throw validationError(`Invalid ${label}: The expression can not be empty;`);
	}
	return { label, source, tokens: tokenize(label, source), cursor: { index: 0 }, context };
};

const peek = (parser: Parser, offset = 0): Token =>
	parser.tokens[Math.min(parser.cursor.index + offset, parser.tokens.length - 1)];

const advance = (parser: Parser): Token => {
	const token = peek(parser);
	parser.cursor.index = Math.min(parser.cursor.index + 1, parser.tokens.length - 1);
	return token;
};

const fail = (parser: Parser, message: string) =>
	validationError(`Invalid ${parser.label}: ${message}`);

const failSyntax = (parser: Parser, token: Token = peek(parser)) =>
	syntaxError(parser.label, parser.source, token);

const isPunctuation = (token: Token, text: PunctuationText): boolean =>
	token.kind === "punctuation" && token.text === text;

const isKeyword = (token: Token, keyword: string): boolean =>
	token.kind === "identifier" && token.text.toUpperCase() === keyword;

const expectPunctuation = (parser: Parser, text: PunctuationText): void => {
	const token = advance(parser);
	if (!isPunctuation(token, text)) {
		throw failSyntax(parser, token);
	}
};

const expectEnd = (parser: Parser): void => {
	const token = peek(parser);
	if (token.kind !== "end") {
		throw failSyntax(parser, token);
	}
};

const resolveNamePlaceholder = (parser: Parser, placeholder: string): string => {
	const name = parser.context.names[placeholder];
	if (name === undefined) {
		throw fail(
			parser,
			`An expression attribute name used in the document path is not defined; attribute name: ${placeholder}`,
		);
	}
	parser.context.usedNames.add(placeholder);
	return name;
};

const resolveValuePlaceholder = (parser: Parser, placeholder: string): AttributeValue => {
	const value = parser.context.values[placeholder];
	if (value === undefined) {
		throw fail(
			parser,
			`An expression attribute value used in expression is not defined; attribute value: ${placeholder}`,
		);
	}
	parser.context.usedValues.add(placeholder);
	return value;
};

const MAX_LIST_INDEX = 2147483647;

const parsePathElementName = (parser: Parser): string => {
	const token = advance(parser);
	if (token.kind === "name") {
		return resolveNamePlaceholder(parser, token.text);
	}
	if (token.kind === "identifier") {
		if (isReservedWord(token.text)) {
			throw fail(parser, `Attribute name is a reserved keyword; reserved keyword: ${token.text}`);
		}
		return token.text;
	}
	throw failSyntax(parser, token);
};

const parseListIndex = (parser: Parser): number => {
	const token = advance(parser);
	if (token.kind !== "integer") {
		throw failSyntax(parser, token);
	}
	const index = Number(token.text);
	if (index > MAX_LIST_INDEX) {
		throw fail(parser, `List index is not within the allowable range; index: [${token.text}]`);
	}
	expectPunctuation(parser, "]");
	return index;
};

const parsePath = (parser: Parser): DocumentPath => {
	const path: DocumentPath = [{ kind: "attribute", name: parsePathElementName(parser) }];
	while (isPunctuation(peek(parser), ".") || isPunctuation(peek(parser), "[")) {
		if (isPunctuation(advance(parser), ".")) {
			path.push({ kind: "attribute", name: parsePathElementName(parser) });
			continue;
		}
		path.push({ kind: "index", index: parseListIndex(parser) });
	}
	return path;
};

const isFunctionCall = (parser: Parser): boolean => {
	if (peek(parser).kind !== "identifier") {
		return false;
	}
	return isPunctuation(peek(parser, 1), "(");
};

const parseFunctionName = (parser: Parser): string => {
	const token = advance(parser);
	expectPunctuation(parser, "(");
	return token.text;
};

const parseArguments = <T>(parser: Parser, parseArgument: () => T): T[] => {
	const args = [parseArgument()];
	while (isPunctuation(peek(parser), ",")) {
		advance(parser);
		args.push(parseArgument());
	}
	expectPunctuation(parser, ")");
	return args;
};

const formatPath = (path: DocumentPath): string =>
	`[${path
		.map((element) => (element.kind === "attribute" ? element.name : `[${element.index}]`))
		.join(", ")}]`;

export const pathsEqual = (left: DocumentPath, right: DocumentPath): boolean => {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((element, index) => {
		const other = right[index];
		if (element.kind === "attribute") {
			return other.kind === "attribute" && other.name === element.name;
		}
		return other.kind === "index" && other.index === element.index;
	});
};

// --- condition operands ----------------------------------------------------

/** The static type of an operand, when it can be known without an item. */
const staticTypeOf = (operand: Operand): AttributeTypeName | undefined => {
	if (operand.kind === "value") {
		return attributeTypeOf(operand.value);
	}
	if (operand.kind === "size") {
		return "N";
	}
	return undefined;
};

const assertOperandType = (
	parser: Parser,
	operand: Operand,
	operatorName: string,
	allowed: (type: AttributeTypeName) => boolean,
): void => {
	const type = staticTypeOf(operand);
	if (type !== undefined && !allowed(type)) {
		throw fail(
			parser,
			`Incorrect operand type for operator or function; operator or function: ${operatorName}, operand type: ${type}`,
		);
	}
};

const assertDistinctOperands = (
	parser: Parser,
	operatorName: string,
	first: Operand,
	rest: Operand[],
): void => {
	if (first.kind !== "path") {
		return;
	}
	const duplicated = rest.some((operand) => {
		if (operand.kind !== "path") {
			return false;
		}
		return pathsEqual(operand.path, first.path);
	});
	if (duplicated) {
		throw fail(
			parser,
			`The first operand must be distinct from the remaining operands for this operator or function; operator: ${operatorName}, first operand: ${formatPath(first.path)}`,
		);
	}
};

const hasSize = (type: AttributeTypeName): boolean =>
	type !== "N" && type !== "BOOL" && type !== "NULL";

const parseConditionOperand = (parser: Parser): Operand => {
	const token = peek(parser);
	if (token.kind === "value") {
		advance(parser);
		return { kind: "value", placeholder: token.text, value: resolveValuePlaceholder(parser, token.text) };
	}
	if (isFunctionCall(parser)) {
		const name = parseFunctionName(parser);
		if (name !== "size") {
			if (isConditionFunction(name)) {
				throw fail(parser, `The function is not allowed to be used this way in an expression; function: ${name}`);
			}
			if (isUpdateFunction(name)) {
				throw fail(parser, `The function is not allowed in a condition expression; function: ${name}`);
			}
			throw fail(parser, `Invalid function name; function: ${name}`);
		}
		const [operand, ...extra] = parseArguments(parser, () => parseConditionOperand(parser));
		if (extra.length > 0) {
			throw fail(parser, "Incorrect number of operands for operator or function; operator or function: size, number of operands: " + String(extra.length + 1));
		}
		assertOperandType(parser, operand, "size", hasSize);
		return { kind: "size", operand };
	}
	if (token.kind === "name" || token.kind === "identifier") {
		return { kind: "path", path: parsePath(parser) };
	}
	throw failSyntax(parser, token);
};

const requirePathOperand = (parser: Parser, operand: Operand, functionName: string): DocumentPath => {
	if (operand.kind !== "path") {
		throw fail(parser, `Operator or function requires a document path; operator or function: ${functionName}`);
	}
	return operand.path;
};

const expectArgumentCount = (parser: Parser, name: string, args: Operand[], count: number): void => {
	if (args.length !== count) {
		throw fail(
			parser,
			`Incorrect number of operands for operator or function; operator or function: ${name}, number of operands: ${args.length}`,
		);
	}
};

const parseConditionFunction = (parser: Parser, name: ConditionFunctionName): Condition => {
	const args = parseArguments(parser, () => parseConditionOperand(parser));
	if (name === "attribute_exists" || name === "attribute_not_exists") {
		expectArgumentCount(parser, name, args, 1);
		return { kind: name, path: requirePathOperand(parser, args[0], name) };
	}
	if (name === "attribute_type") {
		expectArgumentCount(parser, name, args, 2);
		const path = requirePathOperand(parser, args[0], name);
		const typeOperand = args[1];
		assertOperandType(parser, typeOperand, name, (type) => type === "S");
		if (typeOperand.kind !== "value") {
			throw fail(parser, `Operator or function requires a value; operator or function: ${name}`);
		}
		const typeName = typeOperand.value.S ?? "";
		if (!isAttributeTypeName(typeName)) {
			throw fail(
				parser,
				`Invalid attribute type name found; type: ${typeName}, valid types: {N,BS,L,B,NULL,M,S,SS,NS,BOOL}`,
			);
		}
		return { kind: "attribute_type", path, type: typeName };
	}
	expectArgumentCount(parser, name, args, 2);
	assertDistinctOperands(parser, name, args[0], [args[1]]);
	if (name === "begins_with") {
		const isPrefixType = (type: AttributeTypeName) => type === "S" || type === "B";
		assertOperandType(parser, args[0], name, isPrefixType);
		assertOperandType(parser, args[1], name, isPrefixType);
		return { kind: "begins_with", operand: args[0], prefix: args[1] };
	}
	return { kind: "contains", operand: args[0], part: args[1] };
};

const COMPARATORS: readonly Comparator[] = ["=", "<>", "<", "<=", ">", ">="];

const asComparator = (token: Token): Comparator | undefined => {
	if (token.kind !== "punctuation") {
		return undefined;
	}
	return COMPARATORS.find((comparator) => comparator === token.text);
};

const MAX_IN_OPERANDS = 100;

const assertBetweenBounds = (parser: Parser, lower: Operand, upper: Operand): void => {
	if (lower.kind !== "value" || upper.kind !== "value") {
		return;
	}
	const describe = (value: AttributeValue) => {
		const type = attributeTypeOf(value);
		return `AttributeValue: {${type}:${String(Object.values(value)[0])}}`;
	};
	if (attributeTypeOf(lower.value) !== attributeTypeOf(upper.value)) {
		throw fail(
			parser,
			`The BETWEEN operator requires same data type for lower and upper bounds; lower bound operand: ${describe(lower.value)}, upper bound operand: ${describe(upper.value)}`,
		);
	}
	const order = compareOrderedValues(lower.value, upper.value);
	if (order !== undefined && order > 0) {
		throw fail(
			parser,
			`The BETWEEN operator requires upper bound to be greater than or equal to lower bound; lower bound operand: ${describe(lower.value)}, upper bound operand: ${describe(upper.value)}`,
		);
	}
};

const startsComparisonTail = (token: Token): boolean => {
	if (asComparator(token)) {
		return true;
	}
	if (isKeyword(token, "BETWEEN")) {
		return true;
	}
	return isKeyword(token, "IN");
};

const parseComparisonTail = (parser: Parser, left: Operand): Condition => {
	const token = peek(parser);
	const comparator = asComparator(token);
	if (comparator) {
		advance(parser);
		const right = parseConditionOperand(parser);
		if (comparator !== "=" && comparator !== "<>") {
			assertOperandType(parser, left, comparator, isOrderedType);
			assertOperandType(parser, right, comparator, isOrderedType);
		}
		assertDistinctOperands(parser, comparator, left, [right]);
		return { kind: "compare", comparator, left, right };
	}
	if (isKeyword(token, "BETWEEN")) {
		advance(parser);
		const lower = parseConditionOperand(parser);
		if (!isKeyword(advance(parser), "AND")) {
			throw failSyntax(parser, peek(parser, -1));
		}
		const upper = parseConditionOperand(parser);
		[left, lower, upper].forEach((operand) =>
			assertOperandType(parser, operand, "BETWEEN", isOrderedType),
		);
		assertDistinctOperands(parser, "BETWEEN", left, [lower, upper]);
		assertBetweenBounds(parser, lower, upper);
		return { kind: "between", operand: left, lower, upper };
	}
	if (isKeyword(token, "IN")) {
		advance(parser);
		expectPunctuation(parser, "(");
		const candidates = parseArguments(parser, () => parseConditionOperand(parser));
		if (candidates.length > MAX_IN_OPERANDS) {
			throw fail(
				parser,
				`The IN operator is provided with too many operands; number of operands: ${candidates.length}`,
			);
		}
		assertDistinctOperands(parser, "IN", left, candidates);
		return { kind: "in", operand: left, candidates };
	}
	throw failSyntax(parser, token);
};

const parseConditionPrimary = (parser: Parser): Condition => {
	if (isPunctuation(peek(parser), "(")) {
		advance(parser);
		const inner = parseOrCondition(parser);
		expectPunctuation(parser, ")");
		if (inner.kind === "group") {
			throw fail(parser, "The expression has redundant parentheses;");
		}
		return { kind: "group", condition: inner };
	}
	if (isFunctionCall(parser)) {
		const name = peek(parser).text;
		if (isConditionFunction(name)) {
			advance(parser);
			expectPunctuation(parser, "(");
			const condition = parseConditionFunction(parser, name);
			if (startsComparisonTail(peek(parser))) {
				throw fail(parser, `The function is not allowed to be used this way in an expression; function: ${name}`);
			}
			return condition;
		}
		if (!isOperandFunction(name)) {
			advance(parser);
			if (isUpdateFunction(name)) {
				throw fail(parser, `The function is not allowed in a condition expression; function: ${name}`);
			}
			throw fail(parser, `Invalid function name; function: ${name}`);
		}
	}
	const left = parseConditionOperand(parser);
	return parseComparisonTail(parser, left);
};

const parseNotCondition = (parser: Parser): Condition => {
	if (isKeyword(peek(parser), "NOT")) {
		advance(parser);
		return { kind: "not", condition: parseNotCondition(parser) };
	}
	return parseConditionPrimary(parser);
};

const parseAndCondition = (parser: Parser): Condition => {
	const state = { condition: parseNotCondition(parser) };
	while (isKeyword(peek(parser), "AND")) {
		advance(parser);
		state.condition = { kind: "and", left: state.condition, right: parseNotCondition(parser) };
	}
	return state.condition;
};

function parseOrCondition(parser: Parser): Condition {
	const state = { condition: parseAndCondition(parser) };
	while (isKeyword(peek(parser), "OR")) {
		advance(parser);
		state.condition = { kind: "or", left: state.condition, right: parseAndCondition(parser) };
	}
	return state.condition;
}

/**
 * Parse a ConditionExpression, FilterExpression, or KeyConditionExpression.
 * `label` is the request parameter name used in error messages.
 */
export const parseCondition = (
	label: string,
	source: string,
	context: ExpressionContext,
): Condition => {
	const parser = createParser(label, source, context);
	const condition = parseOrCondition(parser);
	expectEnd(parser);
	return condition;
};

// --- update expressions ------------------------------------------------------

const updateValueType = (operand: UpdateOperand): AttributeTypeName | undefined => {
	if (operand.kind === "value") {
		return attributeTypeOf(operand.value);
	}
	return undefined;
};

const assertUpdateOperandType = (
	parser: Parser,
	operand: UpdateOperand,
	operatorName: string,
	allowed: AttributeTypeName,
): void => {
	const type = updateValueType(operand);
	if (type !== undefined && type !== allowed) {
		throw fail(
			parser,
			`Incorrect operand type for operator or function; operator or function: ${operatorName}, operand type: ${type}`,
		);
	}
};

const parseUpdateFunction = (parser: Parser): UpdateOperand => {
	const name = parseFunctionName(parser);
	if (!isUpdateFunction(name)) {
		if (isConditionFunction(name) || isOperandFunction(name)) {
			throw fail(parser, `The function is not allowed in an update expression; function: ${name}`);
		}
		throw fail(parser, `Invalid function name; function: ${name}`);
	}
	const args = parseArguments(parser, () => parseUpdateOperand(parser));
	if (args.length !== 2) {
		throw fail(
			parser,
			`Incorrect number of operands for operator or function; operator or function: ${name}, number of operands: ${args.length}`,
		);
	}
	if (name === "if_not_exists") {
		const [first, fallback] = args;
		if (first.kind !== "path") {
			throw fail(parser, "Operator or function requires a document path; operator or function: if_not_exists");
		}
		if (fallback.kind === "path" && pathsEqual(fallback.path, first.path)) {
			throw fail(
				parser,
				`The first operand must be distinct from the remaining operands for this operator or function; operator: if_not_exists, first operand: ${formatPath(first.path)}`,
			);
		}
		return { kind: "if_not_exists", path: first.path, fallback };
	}
	args.forEach((operand) => assertUpdateOperandType(parser, operand, "list_append", "L"));
	return { kind: "list_append", left: args[0], right: args[1] };
};

function parseUpdateOperand(parser: Parser): UpdateOperand {
	const token = peek(parser);
	if (token.kind === "value") {
		advance(parser);
		return { kind: "value", placeholder: token.text, value: resolveValuePlaceholder(parser, token.text) };
	}
	if (isFunctionCall(parser)) {
		return parseUpdateFunction(parser);
	}
	if (token.kind === "name" || token.kind === "identifier") {
		return { kind: "path", path: parsePath(parser) };
	}
	throw failSyntax(parser, token);
}

const parseArithmeticOperand = (parser: Parser, operatorName: string): UpdateOperand => {
	const operand = parseUpdateOperand(parser);
	if (operand.kind === "list_append") {
		throw fail(parser, "The function is not allowed to be used this way in an expression; function: list_append");
	}
	assertUpdateOperandType(parser, operand, operatorName, "N");
	return operand;
};

/**
 * `SET` right-hand side: an operand, `operand + operand`, `operand - operand`,
 * optionally wrapped in one pair of parentheses.
 */
const parseSetValue = (parser: Parser): SetValue => {
	if (isPunctuation(peek(parser), "(")) {
		advance(parser);
		if (isPunctuation(peek(parser), "(")) {
			throw fail(parser, "The expression has redundant parentheses;");
		}
		const inner = parseSetValue(parser);
		expectPunctuation(parser, ")");
		return inner;
	}
	const startIndex = parser.cursor.index;
	const left = parseUpdateOperand(parser);
	const operatorToken = peek(parser);
	if (!isPunctuation(operatorToken, "+") && !isPunctuation(operatorToken, "-")) {
		return left;
	}
	parser.cursor.index = startIndex;
	const operatorName = operatorToken.text;
	const arithmeticLeft = parseArithmeticOperand(parser, operatorName);
	advance(parser);
	const arithmeticRight = parseArithmeticOperand(parser, operatorName);
	if (operatorName === "+") {
		return { kind: "plus", left: arithmeticLeft, right: arithmeticRight };
	}
	return { kind: "minus", left: arithmeticLeft, right: arithmeticRight };
};

type ClauseKeyword = "SET" | "REMOVE" | "ADD" | "DELETE";
const CLAUSE_KEYWORDS: readonly ClauseKeyword[] = ["SET", "REMOVE", "ADD", "DELETE"];

const asClauseKeyword = (token: Token): ClauseKeyword | undefined => {
	if (token.kind !== "identifier") {
		return undefined;
	}
	return CLAUSE_KEYWORDS.find((keyword) => keyword === token.text.toUpperCase());
};

const isAllowedClauseOperand = (clause: "ADD" | "DELETE", type: AttributeTypeName): boolean => {
	if (isSetType(type)) {
		return true;
	}
	return clause === "ADD" ? type === "N" : false;
};

const requireValueOperand = (parser: Parser, clause: "ADD" | "DELETE"): AttributeValue => {
	const token = advance(parser);
	if (token.kind !== "value") {
		throw failSyntax(parser, token);
	}
	const value = resolveValuePlaceholder(parser, token.text);
	const type = attributeTypeOf(value);
	if (!isAllowedClauseOperand(clause, type)) {
		const typeLabel = type === "S" ? "STRING" : type;
		throw fail(
			parser,
			`Incorrect operand type for operator or function; operator: ${clause}, operand type: ${typeLabel}, typeSet: ALLOWED_FOR_${clause}_OPERAND`,
		);
	}
	return value;
};

const parseClauseAction = (parser: Parser, clause: ClauseKeyword): UpdateAction => {
	const path = parsePath(parser);
	if (clause === "SET") {
		expectPunctuation(parser, "=");
		return { kind: "set", path, value: parseSetValue(parser) };
	}
	if (clause === "REMOVE") {
		return { kind: "remove", path };
	}
	if (clause === "ADD") {
		return { kind: "add", path, value: requireValueOperand(parser, "ADD") };
	}
	return { kind: "delete", path, value: requireValueOperand(parser, "DELETE") };
};

const assertNoOverlappingPaths = (parser: Parser, actions: UpdateAction[]): void => {
	actions.forEach((action, index) => {
		actions.slice(index + 1).forEach((other) => {
			const shorter = action.path.length <= other.path.length ? action.path : other.path;
			const longer = action.path.length <= other.path.length ? other.path : action.path;
			if (pathsEqual(shorter, longer.slice(0, shorter.length))) {
				throw fail(
					parser,
					`Two document paths overlap with each other; must remove or rewrite one of these paths; path one: ${formatPath(action.path)}, path two: ${formatPath(other.path)}`,
				);
			}
		});
	});
};

export type CompiledUpdate = {
	actions: UpdateAction[];
};

export const parseUpdate = (source: string, context: ExpressionContext): CompiledUpdate => {
	const parser = createParser("UpdateExpression", source, context);
	const actions: UpdateAction[] = [];
	const seen = new Set<ClauseKeyword>();
	while (peek(parser).kind !== "end") {
		const clause = asClauseKeyword(advance(parser));
		if (!clause) {
			throw failSyntax(parser, peek(parser, -1));
		}
		if (seen.has(clause)) {
			throw fail(parser, `The "${clause}" section can only be used once in an update expression;`);
		}
		seen.add(clause);
		actions.push(parseClauseAction(parser, clause));
		while (isPunctuation(peek(parser), ",")) {
			advance(parser);
			actions.push(parseClauseAction(parser, clause));
		}
	}
	assertNoOverlappingPaths(parser, actions);
	return { actions };
};

// ---------------------------------------------------------------------------
// Inspection helpers used by the fake's request validation.
// ---------------------------------------------------------------------------

const operandPaths = (operand: Operand): DocumentPath[] => {
	if (operand.kind === "path") {
		return [operand.path];
	}
	if (operand.kind === "size") {
		return operandPaths(operand.operand);
	}
	return [];
};

/** Every document path a condition reads. */
export const conditionPaths = (condition: Condition): DocumentPath[] => {
	switch (condition.kind) {
		case "and":
		case "or":
			return [...conditionPaths(condition.left), ...conditionPaths(condition.right)];
		case "not":
		case "group":
			return conditionPaths(condition.condition);
		case "compare":
			return [...operandPaths(condition.left), ...operandPaths(condition.right)];
		case "between":
			return [condition.operand, condition.lower, condition.upper].flatMap(operandPaths);
		case "in":
			return [condition.operand, ...condition.candidates].flatMap(operandPaths);
		case "attribute_exists":
		case "attribute_not_exists":
		case "attribute_type":
			return [condition.path];
		case "begins_with":
			return [...operandPaths(condition.operand), ...operandPaths(condition.prefix)];
		case "contains":
			return [...operandPaths(condition.operand), ...operandPaths(condition.part)];
	}
};

// ---------------------------------------------------------------------------
// Key conditions (Query)
// ---------------------------------------------------------------------------

export type KeyAttributeDefinition = {
	name: string;
	type: "S" | "N" | "B";
};

export type KeySchemaDefinition = {
	partitionKey: KeyAttributeDefinition;
	sortKey?: KeyAttributeDefinition | undefined;
};

const keyConditionError = (message: string) => validationError(message);

const flattenKeyConditions = (condition: Condition): Condition[] => {
	if (condition.kind === "group") {
		return flattenKeyConditions(condition.condition);
	}
	if (condition.kind === "and") {
		return [...flattenKeyConditions(condition.left), ...flattenKeyConditions(condition.right)];
	}
	if (condition.kind === "or") {
		throw keyConditionError("Invalid operator used in KeyConditionExpression: OR");
	}
	if (condition.kind === "not") {
		throw keyConditionError("Invalid operator used in KeyConditionExpression: NOT");
	}
	return [condition];
};

type KeyLeaf = {
	attribute: string;
	operatorName: string;
	values: AttributeValue[];
};

const keyLeafOperands = (leaf: Condition): { operatorName: string; operands: Operand[] } => {
	if (leaf.kind === "compare") {
		if (leaf.comparator === "<>") {
			throw keyConditionError("Invalid operator used in KeyConditionExpression: <>");
		}
		return { operatorName: leaf.comparator, operands: [leaf.left, leaf.right] };
	}
	if (leaf.kind === "between") {
		return { operatorName: "BETWEEN", operands: [leaf.operand, leaf.lower, leaf.upper] };
	}
	if (leaf.kind === "begins_with") {
		return { operatorName: "begins_with", operands: [leaf.operand, leaf.prefix] };
	}
	if (leaf.kind === "in") {
		throw keyConditionError("Invalid operator used in KeyConditionExpression: IN");
	}
	throw keyConditionError(`Invalid operator used in KeyConditionExpression: ${leaf.kind}`);
};

const toKeyLeaf = (leaf: Condition): KeyLeaf => {
	const { operatorName, operands } = keyLeafOperands(leaf);
	if (operands.some((operand) => operand.kind === "size")) {
		throw keyConditionError("KeyConditionExpressions cannot contain nested operations");
	}
	const paths = operands.flatMap((operand) => (operand.kind === "path" ? [operand.path] : []));
	if (paths.length !== 1) {
		throw keyConditionError(
			"Invalid condition in KeyConditionExpression: Multiple attribute names used in one condition",
		);
	}
	const [path] = paths;
	if (path.length !== 1 || path[0].kind !== "attribute") {
		const head = path[0];
		throw keyConditionError(
			`Key attributes must be scalars; list random access '[]' and map lookup '.' are not allowed: Key: ${head.kind === "attribute" ? head.name : ""}`,
		);
	}
	const values = operands.flatMap((operand) => (operand.kind === "value" ? [operand.value] : []));
	return { attribute: path[0].name, operatorName, values };
};

/**
 * Validate a KeyConditionExpression against the key schema of the queried
 * table or index, the way Query does.
 */
export const assertValidKeyCondition = (
	condition: Condition,
	keySchema: KeySchemaDefinition,
): void => {
	const leaves = flattenKeyConditions(condition).map(toKeyLeaf);
	const seen = new Set<string>();
	leaves.forEach((leaf) => {
		if (seen.has(leaf.attribute)) {
			throw keyConditionError("KeyConditionExpressions must only contain one condition per key");
		}
		seen.add(leaf.attribute);
	});
	const partitionLeaf = leaves.find((leaf) => leaf.attribute === keySchema.partitionKey.name);
	const sortKey = keySchema.sortKey;
	leaves.forEach((leaf) => {
		const isPartition = leaf.attribute === keySchema.partitionKey.name;
		const isSort = sortKey !== undefined && leaf.attribute === sortKey.name;
		if (!isPartition && !isSort) {
			if (partitionLeaf && sortKey === undefined) {
				throw keyConditionError("Query key condition not supported");
			}
			throw keyConditionError("Query condition missed key schema element");
		}
		if (isPartition && leaf.operatorName !== "=") {
			throw keyConditionError("Query key condition not supported");
		}
		const definition = isPartition ? keySchema.partitionKey : sortKey;
		const expectedType = definition?.type;
		const mismatched = leaf.values.some((value) => attributeTypeOf(value) !== expectedType);
		if (mismatched) {
			throw keyConditionError(
				"One or more parameter values were invalid: Condition parameter type does not match schema type",
			);
		}
	});
	if (!partitionLeaf) {
		throw keyConditionError("Query condition missed key schema element");
	}
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Resolve a document path in an item; `undefined` when it does not exist. */
export const resolvePath = (
	item: AttributeMap,
	path: DocumentPath,
): AttributeValue | undefined => {
	const [head, ...rest] = path;
	if (head.kind !== "attribute") {
		return undefined;
	}
	return rest.reduce<AttributeValue | undefined>((current, element) => {
		if (current === undefined) {
			return undefined;
		}
		if (element.kind === "attribute") {
			return current.M === undefined ? undefined : current.M[element.name];
		}
		return current.L === undefined ? undefined : current.L[element.index];
	}, item[head.name]);
};

const evaluateOperand = (item: AttributeMap, operand: Operand): AttributeValue | undefined => {
	if (operand.kind === "value") {
		return operand.value;
	}
	if (operand.kind === "path") {
		return resolvePath(item, operand.path);
	}
	const target = evaluateOperand(item, operand.operand);
	if (target === undefined) {
		return undefined;
	}
	const size = sizeOf(target);
	return size === undefined ? undefined : { N: String(size) };
};

const presentAndEqual = (
	left: AttributeValue | undefined,
	right: AttributeValue | undefined,
): boolean => {
	if (left === undefined || right === undefined) {
		return false;
	}
	return attributeValuesEqual(left, right);
};

const evaluateComparison = (
	comparator: Comparator,
	left: AttributeValue | undefined,
	right: AttributeValue | undefined,
): boolean => {
	if (comparator === "=" || comparator === "<>") {
		const equal = presentAndEqual(left, right);
		return comparator === "=" ? equal : !equal;
	}
	if (left === undefined || right === undefined) {
		return false;
	}
	const order = compareOrderedValues(left, right);
	if (order === undefined) {
		return false;
	}
	switch (comparator) {
		case "<":
			return order < 0;
		case "<=":
			return order <= 0;
		case ">":
			return order > 0;
		case ">=":
			return order >= 0;
	}
};

const evaluateBetween = (
	value: AttributeValue | undefined,
	lower: AttributeValue | undefined,
	upper: AttributeValue | undefined,
): boolean => {
	if (value === undefined || lower === undefined || upper === undefined) {
		return false;
	}
	const fromLower = compareOrderedValues(value, lower);
	const toUpper = compareOrderedValues(value, upper);
	if (fromLower === undefined || toUpper === undefined) {
		return false;
	}
	return fromLower >= 0 && toUpper <= 0;
};

const evaluateBinaryFunction = (
	left: AttributeValue | undefined,
	right: AttributeValue | undefined,
	evaluate: (left: AttributeValue, right: AttributeValue) => boolean,
): boolean => {
	if (left === undefined || right === undefined) {
		return false;
	}
	return evaluate(left, right);
};

/** Evaluate a parsed condition against an item (`{}` for a missing item). */
export const evaluateCondition = (condition: Condition, item: AttributeMap): boolean => {
	switch (condition.kind) {
		case "and":
			return evaluateCondition(condition.left, item) ? evaluateCondition(condition.right, item) : false;
		case "or":
			return evaluateCondition(condition.left, item) ? true : evaluateCondition(condition.right, item);
		case "not":
			return !evaluateCondition(condition.condition, item);
		case "group":
			return evaluateCondition(condition.condition, item);
		case "compare":
			return evaluateComparison(
				condition.comparator,
				evaluateOperand(item, condition.left),
				evaluateOperand(item, condition.right),
			);
		case "between":
			return evaluateBetween(
				evaluateOperand(item, condition.operand),
				evaluateOperand(item, condition.lower),
				evaluateOperand(item, condition.upper),
			);
		case "in": {
			const value = evaluateOperand(item, condition.operand);
			return condition.candidates.some((candidate) =>
				evaluateComparison("=", value, evaluateOperand(item, candidate)),
			);
		}
		case "attribute_exists":
			return resolvePath(item, condition.path) !== undefined;
		case "attribute_not_exists":
			return resolvePath(item, condition.path) === undefined;
		case "attribute_type": {
			const value = resolvePath(item, condition.path);
			return value === undefined ? false : attributeTypeOf(value) === condition.type;
		}
		case "begins_with":
			return evaluateBinaryFunction(
				evaluateOperand(item, condition.operand),
				evaluateOperand(item, condition.prefix),
				beginsWith,
			);
		case "contains":
			return evaluateBinaryFunction(
				evaluateOperand(item, condition.operand),
				evaluateOperand(item, condition.part),
				containsValue,
			);
	}
};

// ---------------------------------------------------------------------------
// Applying updates
// ---------------------------------------------------------------------------

const missingAttributeError = () =>
	validationError("The provided expression refers to an attribute that does not exist in the item");
const incorrectTypeError = () =>
	validationError("An operand in the update expression has an incorrect data type");
const invalidPathError = () =>
	validationError("The document path provided in the update expression is invalid for update");

const evaluateUpdateOperand = (item: AttributeMap, operand: UpdateOperand): AttributeValue => {
	if (operand.kind === "value") {
		return operand.value;
	}
	if (operand.kind === "path") {
		const value = resolvePath(item, operand.path);
		if (value === undefined) {
			throw missingAttributeError();
		}
		return value;
	}
	if (operand.kind === "if_not_exists") {
		return resolvePath(item, operand.path) ?? evaluateUpdateOperand(item, operand.fallback);
	}
	const left = evaluateUpdateOperand(item, operand.left);
	const right = evaluateUpdateOperand(item, operand.right);
	if (left.L === undefined || right.L === undefined) {
		throw incorrectTypeError();
	}
	return { L: [...left.L, ...right.L] };
};

const requireNumber = (value: AttributeValue): string => {
	if (value.N === undefined) {
		throw incorrectTypeError();
	}
	return value.N;
};

const evaluateSetValue = (item: AttributeMap, value: SetValue): AttributeValue => {
	if (value.kind !== "plus" && value.kind !== "minus") {
		return evaluateUpdateOperand(item, value);
	}
	const left = parseDecimal(requireNumber(evaluateUpdateOperand(item, value.left)));
	const right = parseDecimal(requireNumber(evaluateUpdateOperand(item, value.right)));
	const result = formatDecimal(addDecimals(left, value.kind === "plus" ? right : negateDecimal(right)));
	assertStorableNumber(result);
	return { N: result };
};

type Container =
	| { kind: "map"; entries: AttributeMap }
	| { kind: "list"; entries: AttributeValue[] };

/**
 * Resolve the container that holds the last element of `path`, in the
 * mutable copy of the item. Every intermediate element must exist and have
 * the container type its child element needs.
 */
const resolveParentContainer = (item: AttributeMap, path: DocumentPath): Container => {
	const parentPath = path.slice(0, -1);
	if (parentPath.length === 0) {
		return { kind: "map", entries: item };
	}
	const parent = resolvePath(item, parentPath);
	const last = path[path.length - 1];
	if (last.kind === "attribute") {
		if (parent?.M === undefined) {
			throw invalidPathError();
		}
		return { kind: "map", entries: parent.M };
	}
	if (parent?.L === undefined) {
		throw invalidPathError();
	}
	return { kind: "list", entries: parent.L };
};

const writePath = (item: AttributeMap, path: DocumentPath, value: AttributeValue): void => {
	const container = resolveParentContainer(item, path);
	const last = path[path.length - 1];
	if (container.kind === "map" && last.kind === "attribute") {
		container.entries[last.name] = value;
		return;
	}
	if (container.kind === "list" && last.kind === "index") {
		if (last.index < container.entries.length) {
			container.entries[last.index] = value;
			return;
		}
		container.entries.push(value);
		return;
	}
	throw invalidPathError();
};

const removePath = (item: AttributeMap, path: DocumentPath): void => {
	const container = resolveParentContainer(item, path);
	const last = path[path.length - 1];
	if (container.kind === "map" && last.kind === "attribute") {
		delete container.entries[last.name];
		return;
	}
	if (container.kind === "list" && last.kind === "index") {
		if (last.index < container.entries.length) {
			container.entries.splice(last.index, 1);
		}
		return;
	}
	throw invalidPathError();
};

const comparePaths = (left: DocumentPath, right: DocumentPath): number => {
	const length = Math.min(left.length, right.length);
	for (const index of Array.from({ length }, (_, i) => i)) {
		const a = left[index];
		const b = right[index];
		if (a.kind === "index" && b.kind === "index" && a.index !== b.index) {
			return a.index - b.index;
		}
		const aText = a.kind === "index" ? `[${a.index}]` : a.name;
		const bText = b.kind === "index" ? `[${b.index}]` : b.name;
		if (aText !== bText) {
			return aText < bText ? -1 : 1;
		}
	}
	return left.length - right.length;
};

const applyAdd = (item: AttributeMap, path: DocumentPath, value: AttributeValue): void => {
	resolveParentContainer(item, path);
	const current = resolvePath(item, path);
	if (current === undefined) {
		writePath(item, path, cloneAttributeValue(value));
		return;
	}
	const currentType = attributeTypeOf(current);
	if (currentType !== attributeTypeOf(value)) {
		throw incorrectTypeError();
	}
	if (currentType === "N") {
		const result = formatDecimal(addDecimals(parseDecimal(current.N ?? ""), parseDecimal(value.N ?? "")));
		assertStorableNumber(result);
		writePath(item, path, { N: result });
		return;
	}
	writePath(item, path, unionSets(current, value));
};

const applyDelete = (item: AttributeMap, path: DocumentPath, value: AttributeValue): void => {
	resolveParentContainer(item, path);
	const current = resolvePath(item, path);
	if (current === undefined) {
		return;
	}
	if (attributeTypeOf(current) !== attributeTypeOf(value)) {
		throw incorrectTypeError();
	}
	const remaining = subtractSets(current, value);
	if (remaining === undefined) {
		removePath(item, path);
		return;
	}
	writePath(item, path, remaining);
};

/**
 * Apply an update to an item and return the new item. All right-hand sides
 * are evaluated against the item as it was before the update (DynamoDB Local:
 * `SET a = :v, b = a` copies the old `a`). SET actions run first in document
 * path order (so appends past the end of a list land in index order), then
 * REMOVE from the highest list index down, then ADD and DELETE.
 */
export const applyUpdate = (update: CompiledUpdate, item: AttributeMap): AttributeMap => {
	const original = item;
	const next = cloneAttributeMap(item);
	const sets = update.actions.flatMap((action) => (action.kind === "set" ? [action] : []));
	const evaluated = sets.map((action) => ({
		path: action.path,
		value: cloneAttributeValue(evaluateSetValue(original, action.value)),
	}));
	[...evaluated]
		.sort((left, right) => comparePaths(left.path, right.path))
		.forEach((assignment) => writePath(next, assignment.path, assignment.value));
	update.actions
		.flatMap((action) => (action.kind === "remove" ? [action] : []))
		.sort((left, right) => comparePaths(right.path, left.path))
		.forEach((action) => removePath(next, action.path));
	update.actions.forEach((action) => {
		if (action.kind === "add") {
			applyAdd(next, action.path, action.value);
		}
		if (action.kind === "delete") {
			applyDelete(next, action.path, action.value);
		}
	});
	return next;
};

/** Top-level attribute names an update writes or removes. */
export const updatedTopLevelNames = (update: CompiledUpdate): string[] =>
	update.actions.flatMap((action) => {
		const head = action.path[0];
		return head.kind === "attribute" ? [head.name] : [];
	});
