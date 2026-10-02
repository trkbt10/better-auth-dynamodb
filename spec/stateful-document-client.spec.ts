/**
 * @file Differential spec for the in-memory DynamoDB fake.
 *
 * Every scenario (seed items + a sequence of document-client commands) runs
 * twice: against DynamoDB Local and against `createStatefulDocumentClient()`.
 * The two outcomes — normalised command outputs, the thrown error's `name`
 * (and cancellation reason codes), and the resulting table contents — must be
 * equal. Each scenario also pins what DynamoDB Local answers (`expected`), so
 * a scenario cannot pass by both sides failing for an unrelated reason.
 *
 * The request shapes the adapter emits are produced with the adapter's own
 * builders (`buildFilterExpression`, `buildAtomicCondition`,
 * `buildIncrementExpression`, `buildPatchUpdateExpression`,
 * `executeTransaction`), so the fake is proven on exactly those shapes.
 */
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
	BatchGetCommand,
	BatchWriteCommand,
	DeleteCommand,
	GetCommand,
	NumberValue,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactGetCommand,
	TransactWriteCommand,
	UpdateCommand,
	type DynamoDBDocumentClient,
	type NativeAttributeValue,
	type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { BetterAuthOptions } from "@better-auth/core";
import type { DBTransactionAdapter } from "@better-auth/core/db/adapter";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { dynamodbAdapter } from "../src/adapter";
import { buildConditionInput } from "../src/adapter-methods/atomic-write";
import { buildAtomicCondition } from "../src/dynamodb/expressions/build-atomic-condition";
import { buildFilterExpression } from "../src/dynamodb/expressions/build-filter-expression";
import {
	buildIncrementExpression,
	resolveIncrementAssignments,
} from "../src/dynamodb/expressions/build-increment-expression";
import { buildPatchUpdateExpression } from "../src/dynamodb/expressions/build-patch-update-expression";
import {
	bufferTransactionCreate,
	bufferTransactionWrite,
	createTransactionState,
	executeTransaction,
	pinTransactionFields,
	type DynamoDBTransactionState,
} from "../src/dynamodb/ops/transaction";
import type { DynamoDBWhere, TableSchema } from "../src/dynamodb/types";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../src/table-schemas";
import {
	buildTestConfig,
	createTestClients,
	deleteTables,
	tableNamesFromSchemas,
} from "./adapter-test-helpers";
import { createStatefulDocumentClient } from "./stateful-document-client";

type Item = Record<string, NativeAttributeValue>;

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
});
const { client: realLowLevelClient, documentClient: realClient } = createTestClients(testConfig);

const tableNamePrefix = `fake_diff_${Date.now()}_`;

// ---------------------------------------------------------------------------
// Tables shared by both backends
// ---------------------------------------------------------------------------

const ITEMS_SCHEMA: TableSchema = {
	tableName: "items",
	tableDefinition: {
		billingMode: "PAY_PER_REQUEST",
		attributeDefinitions: [
			{ AttributeName: "id", AttributeType: "S" },
			{ AttributeName: "gp", AttributeType: "S" },
			{ AttributeName: "gs", AttributeType: "S" },
			{ AttributeName: "np", AttributeType: "S" },
			{ AttributeName: "nn", AttributeType: "N" },
		],
		keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
		globalSecondaryIndexes: [
			{
				IndexName: "gsi_sorted",
				KeySchema: [
					{ AttributeName: "gp", KeyType: "HASH" },
					{ AttributeName: "gs", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "gsi_hash",
				KeySchema: [{ AttributeName: "gp", KeyType: "HASH" }],
				Projection: { ProjectionType: "ALL" },
			},
			{
				IndexName: "gsi_number",
				KeySchema: [
					{ AttributeName: "np", KeyType: "HASH" },
					{ AttributeName: "nn", KeyType: "RANGE" },
				],
				Projection: { ProjectionType: "ALL" },
			},
		],
	},
	indexMappings: [],
};

const COMPOSITE_SCHEMA: TableSchema = {
	tableName: "composite",
	tableDefinition: {
		billingMode: "PAY_PER_REQUEST",
		attributeDefinitions: [
			{ AttributeName: "pk", AttributeType: "S" },
			{ AttributeName: "sk", AttributeType: "N" },
		],
		keySchema: [
			{ AttributeName: "pk", KeyType: "HASH" },
			{ AttributeName: "sk", KeyType: "RANGE" },
		],
	},
	indexMappings: [],
};

const SCHEMAS = [ITEMS_SCHEMA, COMPOSITE_SCHEMA];

type Tables = { items: string; composite: string };

const TABLES: Tables = {
	items: `${tableNamePrefix}items`,
	composite: `${tableNamePrefix}composite`,
};

const CREATED_SCHEMAS: TableSchema[] = SCHEMAS.map((schema) => ({
	...schema,
	tableName: `${tableNamePrefix}${schema.tableName}`,
}));

const createFakeClient = () =>
	createStatefulDocumentClient({ tableSchemas: SCHEMAS, tableNamePrefix });

// ---------------------------------------------------------------------------
// Scenario model
// ---------------------------------------------------------------------------

type DocumentCommand =
	| GetCommand
	| PutCommand
	| UpdateCommand
	| DeleteCommand
	| QueryCommand
	| ScanCommand
	| BatchGetCommand
	| TransactWriteCommand;

type Step =
	| { kind: "send"; build: (tables: Tables) => DocumentCommand }
	| {
			kind: "paginate";
			build: (tables: Tables, exclusiveStartKey: Item | undefined) => QueryCommand | ScanCommand;
			unordered: boolean;
	  }
	| {
			kind: "transaction";
			buffer: (state: DynamoDBTransactionState, tables: Tables) => void;
	  };

type ExpectedOutcome =
	| "ok"
	| "ValidationException"
	| "ConditionalCheckFailedException"
	| "TransactionCanceledException";

type Scenario = {
	name: string;
	seed?: { items?: Item[]; composite?: Item[] } | undefined;
	steps: Step[];
	/** What DynamoDB Local answers. */
	expected: ExpectedOutcome;
};

const send = (build: (tables: Tables) => DocumentCommand): Step => ({ kind: "send", build });

const paginate = (
	build: (tables: Tables, exclusiveStartKey: Item | undefined) => QueryCommand | ScanCommand,
	unordered: boolean,
): Step => ({ kind: "paginate", build, unordered });

const transaction = (
	buffer: (state: DynamoDBTransactionState, tables: Tables) => void,
): Step => ({
	kind: "transaction",
	buffer,
});

// ---------------------------------------------------------------------------
// Execution and normalisation
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** A deterministic text form, used to sort unordered results. */
const stableKey = (value: unknown): string => {
	if (value instanceof Uint8Array) {
		return `bin:${toHex(value)}`;
	}
	if (value instanceof Set) {
		return `set[${Array.from(value, stableKey).sort().join(",")}]`;
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableKey).join(",")}]`;
	}
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${key}:${stableKey(value[key])}`)
			.join(",")}}`;
	}
	return `${typeof value}:${String(value)}`;
};

const sortItems = (items: unknown): unknown => {
	if (!Array.isArray(items)) {
		return items;
	}
	return [...items].sort((left, right) => (stableKey(left) < stableKey(right) ? -1 : 1));
};

const hasUnorderedItems = (command: DocumentCommand): boolean => {
	if (command instanceof ScanCommand || command instanceof BatchGetCommand) {
		return true;
	}
	if (command instanceof QueryCommand) {
		return command.input.IndexName === "gsi_hash";
	}
	return false;
};

const OUTPUT_FIELDS = ["Item", "Items", "Attributes", "Count", "ScannedCount", "LastEvaluatedKey"] as const;

/**
 * Keep the fields that carry DynamoDB's answer. For reads whose order is
 * DynamoDB's hash order, Items are sorted and a LastEvaluatedKey is reduced
 * to its presence (its value depends on that order).
 */
const normalizeOutput = (output: unknown, unordered: boolean): Record<string, unknown> => {
	const record = isRecord(output) ? output : {};
	const normalized: Record<string, unknown> = {};
	OUTPUT_FIELDS.forEach((field) => {
		if (record[field] !== undefined) {
			normalized[field] = record[field];
		}
	});
	if (unordered) {
		if (normalized.Items !== undefined) {
			normalized.Items = sortItems(normalized.Items);
		}
		if (normalized.LastEvaluatedKey !== undefined) {
			// Which items a page cut by Limit holds depends on the hash order;
			// their number does not (pagination scenarios compare the union).
			normalized.LastEvaluatedKey = "present";
			delete normalized.Items;
		}
	}
	const responses = record.Responses;
	if (isRecord(responses)) {
		normalized.Responses = Object.fromEntries(
			Object.entries(responses).map(([tableName, items]) => [tableName, sortItems(items)]),
		);
	}
	if (record.UnprocessedKeys !== undefined) {
		normalized.UnprocessedKeys = record.UnprocessedKeys;
	}
	return normalized;
};

const sendCommand = (client: DynamoDBDocumentClient, command: DocumentCommand): Promise<unknown> => {
	if (command instanceof GetCommand) {
		return client.send(command);
	}
	if (command instanceof PutCommand) {
		return client.send(command);
	}
	if (command instanceof UpdateCommand) {
		return client.send(command);
	}
	if (command instanceof DeleteCommand) {
		return client.send(command);
	}
	if (command instanceof QueryCommand) {
		return client.send(command);
	}
	if (command instanceof ScanCommand) {
		return client.send(command);
	}
	if (command instanceof BatchGetCommand) {
		return client.send(command);
	}
	return client.send(command);
};

const readLastEvaluatedKey = (output: unknown): Item | undefined => {
	if (!isRecord(output)) {
		return undefined;
	}
	const key = output.LastEvaluatedKey;
	if (!isRecord(key)) {
		return undefined;
	}
	return Object.fromEntries(Object.entries(key));
};

const MAX_PAGES = 50;

const collectPages = async (
	client: DynamoDBDocumentClient,
	step: Extract<Step, { kind: "paginate" }>,
): Promise<unknown> => {
	const pages: Record<string, unknown>[] = [];
	const items: unknown[] = [];
	const cursor: { key: Item | undefined } = { key: undefined };
	for (const page of Array.from({ length: MAX_PAGES }, (_, index) => index)) {
		const output = await sendCommand(client, step.build(TABLES, cursor.key));
		pages.push(normalizeOutput(output, step.unordered));
		if (isRecord(output) && Array.isArray(output.Items)) {
			items.push(...output.Items);
		}
		cursor.key = readLastEvaluatedKey(output);
		if (cursor.key === undefined) {
			break;
		}
		if (page === MAX_PAGES - 1) {
			throw new Error("pagination did not terminate");
		}
	}
	if (!step.unordered) {
		return { pages };
	}
	// In hash order the split of items over pages differs between engines;
	// the union of the pages and the number of items evaluated per page do not.
	return {
		items: sortItems(items),
		scannedPerPage: pages.map((page) => page.ScannedCount),
	};
};

const runStep = async (client: DynamoDBDocumentClient, step: Step): Promise<unknown> => {
	if (step.kind === "send") {
		const command = step.build(TABLES);
		return normalizeOutput(await sendCommand(client, command), hasUnorderedItems(command));
	}
	if (step.kind === "paginate") {
		return collectPages(client, step);
	}
	const state = createTransactionState();
	step.buffer(state, TABLES);
	await executeTransaction({ documentClient: client, state });
	return { transaction: "committed" };
};

type ErrorOutcome = { name: string; cancellationCodes?: string[] | undefined };

const readCancellationCodes = (error: Error): string[] | undefined => {
	if (!("CancellationReasons" in error)) {
		return undefined;
	}
	const reasons = error.CancellationReasons;
	if (!Array.isArray(reasons)) {
		return undefined;
	}
	return reasons.map((reason) => (isRecord(reason) ? String(reason.Code) : "?"));
};

const describeError = (error: unknown): ErrorOutcome => {
	if (!(error instanceof Error)) {
		return { name: `non-error: ${String(error)}` };
	}
	const cancellationCodes = readCancellationCodes(error);
	if (cancellationCodes === undefined) {
		return { name: error.name };
	}
	return { name: error.name, cancellationCodes };
};

const scanAll = async (client: DynamoDBDocumentClient, tableName: string): Promise<unknown> => {
	const output = await client.send(new ScanCommand({ TableName: tableName }));
	return sortItems(output.Items ?? []);
};

type Outcome = {
	outputs: unknown[];
	error: ErrorOutcome | undefined;
	tables: { items: unknown; composite: unknown };
};

const runSteps = async (
	client: DynamoDBDocumentClient,
	steps: Step[],
	outputs: unknown[],
): Promise<ErrorOutcome | undefined> => {
	for (const step of steps) {
		try {
			outputs.push(await runStep(client, step));
		} catch (error) {
			return describeError(error);
		}
	}
	return undefined;
};

const seedTables = async (client: DynamoDBDocumentClient, scenario: Scenario): Promise<void> => {
	for (const item of scenario.seed?.items ?? []) {
		await client.send(new PutCommand({ TableName: TABLES.items, Item: item }));
	}
	for (const item of scenario.seed?.composite ?? []) {
		await client.send(new PutCommand({ TableName: TABLES.composite, Item: item }));
	}
};

const runScenario = async (client: DynamoDBDocumentClient, scenario: Scenario): Promise<Outcome> => {
	await seedTables(client, scenario);
	const outputs: unknown[] = [];
	const error = await runSteps(client, scenario.steps, outputs);
	return {
		outputs,
		error,
		tables: {
			items: await scanAll(client, TABLES.items),
			composite: await scanAll(client, TABLES.composite),
		},
	};
};

const clearRealTables = async (): Promise<void> => {
	const items = await realClient.send(new ScanCommand({ TableName: TABLES.items }));
	for (const item of items.Items ?? []) {
		await realClient.send(new DeleteCommand({ TableName: TABLES.items, Key: { id: item.id } }));
	}
	const composite = await realClient.send(new ScanCommand({ TableName: TABLES.composite }));
	for (const item of composite.Items ?? []) {
		await realClient.send(
			new DeleteCommand({ TableName: TABLES.composite, Key: { pk: item.pk, sk: item.sk } }),
		);
	}
};

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

type Placeholders = {
	values?: Item | undefined;
	names?: Record<string, string> | undefined;
};

const filterScan = (expression: string, placeholders: Placeholders = {}): Step =>
	send(
		(tables) =>
			new ScanCommand({
				TableName: tables.items,
				FilterExpression: expression,
				ExpressionAttributeValues: placeholders.values,
				ExpressionAttributeNames: placeholders.names,
			}),
	);

const TYPED_SEED: Item[] = [
	{ id: "n", a: 5 },
	{ id: "s", a: "5" },
	{ id: "null", a: null },
	{ id: "missing" },
	{ id: "bool", a: true },
	{ id: "list", a: ["x", 1] },
	{ id: "map", a: { k: "x", deep: { d: 1 } } },
	{ id: "ss", a: new Set(["x", "y"]) },
	{ id: "ns", a: new Set([1, 2]) },
	{ id: "bin", a: new Uint8Array([1, 2]) },
	{ id: "bmp", a: "｡" },
	{ id: "astral", a: "\u{1F600}é" },
];

const filterScenario = (
	name: string,
	expression: string,
	placeholders: Placeholders,
	expected: ExpectedOutcome = "ok",
): Scenario => ({
	name: `filter: ${name}`,
	seed: { items: TYPED_SEED },
	steps: [filterScan(expression, placeholders)],
	expected,
});

const manyValues = (count: number): Item =>
	Object.fromEntries(Array.from({ length: count }, (_, index) => [`:v${index}`, index]));

const manyPlaceholders = (count: number): string =>
	Array.from({ length: count }, (_, index) => `:v${index}`).join(", ");

const FILTER_SCENARIOS: Scenario[] = [
	filterScenario("= on a number", "a = :v", { values: { ":v": 5 } }),
	filterScenario("= compares numbers by value (5 = 5.00)", "a = :v", {
		values: { ":v": NumberValue.from("5.00") },
	}),
	filterScenario("= distinguishes numbers with 38 significant digits", "a = :v", {
		values: { ":v": NumberValue.from("5.0000000000000000000000000000000000001") },
	}),
	filterScenario("<> is true for missing and differently typed attributes", "a <> :v", { values: { ":v": 5 } }),
	filterScenario("< on numbers only matches numbers", "a < :v", { values: { ":v": 6 } }),
	filterScenario("< on strings only matches strings", "a < :v", { values: { ":v": "6" } }),
	filterScenario("< orders strings by UTF-8 bytes, not UTF-16 units", "a < :v", {
		values: { ":v": "\u{1F600}" },
	}),
	filterScenario("> orders strings by UTF-8 bytes, not UTF-16 units", "a > :v", { values: { ":v": "｡" } }),
	filterScenario("< on binaries compares bytes", "a < :v", { values: { ":v": new Uint8Array([9]) } }),
	filterScenario("< rejects a BOOL operand", "a < :v", { values: { ":v": true } }, "ValidationException"),
	filterScenario("< rejects a NULL operand", "a < :v", { values: { ":v": null } }, "ValidationException"),
	filterScenario("< rejects a list operand", "a < :v", { values: { ":v": [] } }, "ValidationException"),
	filterScenario("< rejects a map operand", "a < :v", { values: { ":v": {} } }, "ValidationException"),
	filterScenario("< rejects a set operand", "a < :v", { values: { ":v": new Set(["a"]) } }, "ValidationException"),
	filterScenario("<= and >= are inclusive", "a <= :hi AND a >= :lo", { values: { ":hi": 5, ":lo": 5 } }),
	filterScenario("< between two values", ":a < :b", { values: { ":a": 1, ":b": 2 } }),
	filterScenario("< between two values of different types is false", ":a < :b", { values: { ":a": 1, ":b": "2" } }),
	filterScenario("< between two paths of different types is false", "a < id", {}),
	filterScenario("= NULL matches NULL attributes", "a = :v", { values: { ":v": null } }),
	filterScenario("<> NULL", "a <> :v", { values: { ":v": null } }),
	filterScenario("= on lists compares elements by value", "a = :v", {
		values: { ":v": ["x", NumberValue.from("1.0")] },
	}),
	filterScenario("= on maps", "a = :v", { values: { ":v": { deep: { d: 1 }, k: "x" } } }),
	filterScenario("= on string sets ignores member order", "a = :v", { values: { ":v": new Set(["y", "x"]) } }),
	filterScenario("= on BOOL", "a = :v", { values: { ":v": true } }),
	filterScenario("= on an empty string", "a = :v", { values: { ":v": "" } }),
	filterScenario("= with both operands missing is false", "q = r", {}),
	filterScenario("<> with both operands missing is true", "q <> r", {}),
	filterScenario("IN", "a IN (:v, :w)", { values: { ":v": 5, ":w": true } }),
	filterScenario("NOT ... IN", "NOT a IN (:v, :w)", { values: { ":v": 5, ":w": true } }),
	filterScenario("NOT (... IN ...)", "NOT (a IN (:v))", { values: { ":v": "5" } }),
	filterScenario("IN with one operand", "a IN (:v)", { values: { ":v": 5 } }),
	filterScenario("IN accepts 100 operands", `a IN (${manyPlaceholders(100)})`, { values: manyValues(100) }),
	filterScenario(
		"IN rejects 101 operands",
		`a IN (${manyPlaceholders(101)})`,
		{ values: manyValues(101) },
		"ValidationException",
	),
	filterScenario("BETWEEN numbers", "a BETWEEN :lo AND :hi", { values: { ":lo": 1, ":hi": 9 } }),
	filterScenario("BETWEEN strings", "a BETWEEN :lo AND :hi", { values: { ":lo": "｠", ":hi": "｢" } }),
	filterScenario("BETWEEN with equal bounds", "a BETWEEN :v AND :v", { values: { ":v": 5 } }),
	filterScenario(
		"BETWEEN rejects reversed bounds",
		"a BETWEEN :lo AND :hi",
		{ values: { ":lo": 9, ":hi": 1 } },
		"ValidationException",
	),
	filterScenario(
		"BETWEEN rejects bounds of different types",
		"a BETWEEN :lo AND :hi",
		{ values: { ":lo": 1, ":hi": "9" } },
		"ValidationException",
	),
	filterScenario(
		"BETWEEN rejects BOOL bounds",
		"a BETWEEN :lo AND :hi",
		{ values: { ":lo": false, ":hi": true } },
		"ValidationException",
	),
	filterScenario("BETWEEN binds tighter than AND", "a BETWEEN :lo AND :hi AND id = :id", {
		values: { ":lo": 1, ":hi": 9, ":id": "n" },
	}),
	filterScenario("begins_with on strings", "begins_with(a, :v)", { values: { ":v": "5" } }),
	filterScenario("begins_with on binaries", "begins_with(a, :v)", { values: { ":v": new Uint8Array([1]) } }),
	filterScenario(
		"begins_with rejects a number operand",
		"begins_with(a, :v)",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario(
		"begins_with rejects a number as first operand",
		"begins_with(:v, a)",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario(
		"begins_with rejects a BOOL operand",
		"begins_with(a, :v)",
		{ values: { ":v": true } },
		"ValidationException",
	),
	filterScenario("begins_with with a value first", "begins_with(:v, a)", { values: { ":v": "55" } }),
	filterScenario("contains on strings, string sets, and lists", "contains(a, :v)", { values: { ":v": "x" } }),
	filterScenario("contains a number in number sets and lists", "contains(a, :v)", { values: { ":v": 1 } }),
	filterScenario("contains on binaries", "contains(a, :v)", { values: { ":v": new Uint8Array([2]) } }),
	filterScenario("contains with a list operand", "contains(a, :v)", { values: { ":v": [] } }),
	filterScenario("contains with a map operand matches a list element", "contains(a, :v)", {
		values: { ":v": { k: "x" } },
	}),
	filterScenario("contains with a NULL operand", "contains(a, :v)", { values: { ":v": null } }),
	filterScenario("contains with a value first", "contains(:v, a)", { values: { ":v": "x5y" } }),
	filterScenario("size > 0", "size(a) > :v", { values: { ":v": 0 } }),
	filterScenario("size = 1 (string, map)", "size(a) = :v", { values: { ":v": 1 } }),
	filterScenario("size = 2 (sets, list, binary)", "size(a) = :v", { values: { ":v": 2 } }),
	filterScenario("size counts UTF-16 code units", "size(a) = :v", { values: { ":v": 3 } }),
	filterScenario("size compared with a string is false", "size(a) = :v", { values: { ":v": "2" } }),
	filterScenario("size of a value", "size(:s) = :n", { values: { ":s": "ab", ":n": 2 } }),
	filterScenario("size compared with size", "size(a) < size(id)", {}),
	filterScenario("size compared with a path", "size(a) = a", {}),
	filterScenario("size rejects a number value", "size(:v) = :n", { values: { ":v": 1, ":n": 1 } }, "ValidationException"),
	filterScenario("size of size is rejected", "size(size(a)) = :n", { values: { ":n": 1 } }, "ValidationException"),
	filterScenario("size rejects a BOOL value", "size(:v) = :n", { values: { ":v": true, ":n": 1 } }, "ValidationException"),
	filterScenario("size rejects a NULL value", "size(:v) = :n", { values: { ":v": null, ":n": 1 } }, "ValidationException"),
	filterScenario("size of a list value", "size(:v) = :n", { values: { ":v": [1, 2], ":n": 2 } }),
	filterScenario(
		"if_not_exists is not a condition function",
		"a = if_not_exists(a, :v)",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario(
		"list_append is not a condition function",
		"a = list_append(a, :v)",
		{ values: { ":v": [5] } },
		"ValidationException",
	),
	filterScenario("attribute_exists", "attribute_exists(a)", {}),
	filterScenario("attribute_not_exists", "attribute_not_exists(a)", {}),
	filterScenario("attribute_exists on a nested path", "attribute_exists(a.k)", {}),
	filterScenario("attribute_type N", "attribute_type(a, :t)", { values: { ":t": "N" } }),
	filterScenario("attribute_type NULL", "attribute_type(a, :t)", { values: { ":t": "NULL" } }),
	filterScenario("attribute_type M on a nested path", "attribute_type(a.deep, :t)", { values: { ":t": "M" } }),
	filterScenario(
		"attribute_type rejects an unknown type",
		"attribute_type(a, :t)",
		{ values: { ":t": "X" } },
		"ValidationException",
	),
	filterScenario(
		"attribute_type rejects a number operand",
		"attribute_type(a, :t)",
		{ values: { ":t": 1 } },
		"ValidationException",
	),
	filterScenario(
		"attribute_exists requires a path",
		"attribute_exists(:v)",
		{ values: { ":v": 1 } },
		"ValidationException",
	),
	filterScenario("NOT binds tighter than AND", "NOT a = :v AND id = :id", { values: { ":v": 5, ":id": "s" } }),
	filterScenario("AND binds tighter than OR", "a = :v OR a = :w AND id = :id", {
		values: { ":v": 5, ":w": "5", ":id": "zzz" },
	}),
	filterScenario("parentheses override precedence", "(a = :v OR a = :w) AND id = :id", {
		values: { ":v": 5, ":w": "5", ":id": "s" },
	}),
	filterScenario("double NOT", "NOT NOT a = :v", { values: { ":v": 5 } }),
	filterScenario("NOT <>", "NOT a <> :v", { values: { ":v": 5 } }),
	filterScenario("keywords are case-insensitive", "a = :v and id = :id or not a = a.k", {
		values: { ":v": 5, ":id": "n" },
	}),
	filterScenario(
		"redundant parentheses are rejected",
		"((a = :v))",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario("function names are case-sensitive", "ATTRIBUTE_EXISTS(a)", {}, "ValidationException"),
	filterScenario("unknown functions are rejected", "starts_with(a, :v)", { values: { ":v": "5" } }, "ValidationException"),
	filterScenario(
		"a condition function cannot be an operand",
		"attribute_exists(a) = :v",
		{ values: { ":v": true } },
		"ValidationException",
	),
	filterScenario("a bare path is not a condition", "a", {}, "ValidationException"),
	filterScenario("a dangling AND is a syntax error", "a = :v AND", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario("comparisons do not chain", "a = :v = :v", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario("a value as both operands", ":v = :v", { values: { ":v": 5 } }),
	filterScenario("identical path operands are rejected", "a = a", {}, "ValidationException"),
	filterScenario(
		"identical operands are compared after name resolution",
		"#a = a",
		{ names: { "#a": "a" } },
		"ValidationException",
	),
	filterScenario(
		"IN rejects the first operand among the candidates",
		"a IN (:v, a)",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario(
		"BETWEEN rejects the first operand as a bound",
		"a BETWEEN a AND :v",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario("contains rejects identical operands", "contains(a, a)", {}, "ValidationException"),
	filterScenario("a path and its nested path are distinct", "a = a.k", {}),
	filterScenario("nested map paths", "a.k = :v", { values: { ":v": "x" } }),
	filterScenario("nested placeholders", "#a.#d.#e = :v", { names: { "#a": "a", "#d": "deep", "#e": "d" }, values: { ":v": 1 } }),
	filterScenario("a placeholder naming a dotted attribute is one name", "#ak = :v", {
		names: { "#ak": "a.k" },
		values: { ":v": "x" },
	}),
	filterScenario("a nested path through a missing attribute", "#q.#k = :v", {
		names: { "#q": "q", "#k": "k" },
		values: { ":v": "x" },
	}),
	filterScenario("<> on a nested path through a missing attribute", "#q.#k <> :v", {
		names: { "#q": "q", "#k": "k" },
		values: { ":v": "x" },
	}),
	filterScenario("list index", "a[0] = :v", { values: { ":v": "x" } }),
	filterScenario("whitespace inside a path", "a . k = :v OR a [1] = :w", { values: { ":v": "x", ":w": 1 } }),
	filterScenario("list index 2147483647 is accepted", "a[2147483647] = :v", { values: { ":v": "x" } }),
	filterScenario(
		"list index 2147483648 is rejected",
		"a[2147483648] = :v",
		{ values: { ":v": "x" } },
		"ValidationException",
	),
	filterScenario("a negative list index is a syntax error", "a[-1] = :v", { values: { ":v": "x" } }, "ValidationException"),
	filterScenario("a value cannot be indexed", ":v[0] = :v", { values: { ":v": "x" } }, "ValidationException"),
	filterScenario("reserved words cannot be plain names", "name = :v", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario(
		"reserved words are case-insensitive",
		"Status = :v",
		{ values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario("plain names start with a letter", "_a = :v", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario("placeholders may use letters, digits, and underscores", "#aB_1 = :vB_1", {
		names: { "#aB_1": "a" },
		values: { ":vB_1": 5 },
	}),
	filterScenario(
		"an invalid name placeholder key is rejected",
		"a = :v",
		{ names: { "#a-b": "a" }, values: { ":v": 5 } },
		"ValidationException",
	),
	filterScenario(
		"an unused value placeholder is rejected",
		"a = :v",
		{ values: { ":v": 5, ":w": 1 } },
		"ValidationException",
	),
	filterScenario("an undefined value placeholder is rejected", "a = :w", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario("an unused name placeholder is rejected", "a = :v", { names: { "#x": "a" }, values: { ":v": 5 } }, "ValidationException"),
	filterScenario("an undefined name placeholder is rejected", "#x = :v", { values: { ":v": 5 } }, "ValidationException"),
	filterScenario("an empty ExpressionAttributeValues map is rejected", "attribute_exists(a)", { values: {} }, "ValidationException"),
	filterScenario("an empty ExpressionAttributeNames map is rejected", "attribute_exists(a)", { names: {} }, "ValidationException"),
	filterScenario("an empty expression is rejected", "", { values: undefined }, "ValidationException"),
];

// Filter expressions exactly as the adapter's buildFilterExpression emits them.
const getFieldName = ({ field }: { model: string; field: string }): string => field;

const adapterFilterScenario = (name: string, where: DynamoDBWhere[]): Scenario => {
	const filter = buildFilterExpression({ model: "items", where, getFieldName });
	if (filter.filterExpression === undefined) {
		throw new Error(`buildFilterExpression produced no server-side filter for "${name}"`);
	}
	const expression = filter.filterExpression;
	return {
		name: `adapter filter: ${name} (${expression})`,
		seed: { items: TYPED_SEED },
		steps: [
			filterScan(expression, {
				names: filter.expressionAttributeNames,
				values: filter.expressionAttributeValues,
			}),
		],
		expected: "ok",
	};
};

const ADAPTER_FILTER_SCENARIOS: Scenario[] = [
	adapterFilterScenario("eq", [{ field: "a", operator: "eq", value: 5 }]),
	adapterFilterScenario("ne", [{ field: "a", operator: "ne", value: 5 }]),
	adapterFilterScenario("gt + lte", [
		{ field: "a", operator: "gt", value: "4" },
		{ field: "a", operator: "lte", value: "6" },
	]),
	adapterFilterScenario("gte + lt on numbers", [
		{ field: "a", operator: "gte", value: 5 },
		{ field: "a", operator: "lt", value: 6 },
	]),
	adapterFilterScenario("in", [{ field: "a", operator: "in", value: [5, "5", true] }]),
	adapterFilterScenario("not_in", [{ field: "a", operator: "not_in", value: [5, "5"] }]),
	adapterFilterScenario("contains", [{ field: "a", operator: "contains", value: "x" }]),
	adapterFilterScenario("starts_with", [{ field: "a", operator: "starts_with", value: "5" }]),
	adapterFilterScenario("AND group with OR group", [
		{ field: "id", operator: "ne", value: "n" },
		{ field: "a", operator: "eq", value: 5, connector: "OR" },
		{ field: "a", operator: "eq", value: "5", connector: "OR" },
	]),
	adapterFilterScenario("OR only", [
		{ field: "a", operator: "eq", value: true, connector: "OR" },
		{ field: "a", operator: "in", value: [null], connector: "OR" },
	]),
];

// ---------------------------------------------------------------------------
// Update expressions
// ---------------------------------------------------------------------------

const BASE_ITEM: Item = {
	id: "k",
	n: 5,
	s: "str",
	nul: null,
	l: ["x", 1, "z"],
	m: { k: "x", deep: { d: 1 } },
	ss: new Set(["x", "y"]),
	ns: new Set([1, 2]),
	gp: "p",
};

const updateCommand = (
	expression: string | undefined,
	placeholders: Placeholders = {},
	extra: Partial<UpdateCommandInput> = {},
): Step =>
	send(
		(tables) =>
			new UpdateCommand({
				TableName: tables.items,
				Key: { id: "k" },
				UpdateExpression: expression,
				ExpressionAttributeValues: placeholders.values,
				ExpressionAttributeNames: placeholders.names,
				ReturnValues: "ALL_NEW",
				...extra,
			}),
	);

const updateScenario = (
	name: string,
	expression: string | undefined,
	placeholders: Placeholders = {},
	expected: ExpectedOutcome = "ok",
	extra: Partial<UpdateCommandInput> = {},
): Scenario => ({
	name: `update: ${name}`,
	seed: { items: [BASE_ITEM] },
	steps: [updateCommand(expression, placeholders, extra)],
	expected,
});

const one = { ":one": 1 };

const UPDATE_SCENARIOS: Scenario[] = [
	updateScenario("SET a = a + :v", "SET n = n + :one", { values: one }),
	updateScenario("SET a = a - :v", "SET n = n - :one", { values: one }),
	updateScenario("arithmetic is exact decimal arithmetic", "SET n = :a + :b", {
		values: { ":a": NumberValue.from("0.1"), ":b": NumberValue.from("0.2") },
	}),
	updateScenario("arithmetic beyond 38 significant digits is rejected", "SET n = :a + :b", {
		values: { ":a": NumberValue.from("99999999999999999999999999999999999999"), ":b": NumberValue.from("0.1") },
	}, "ValidationException"),
	updateScenario("arithmetic on two values", "SET q = :one + :one", { values: one }),
	updateScenario("arithmetic with if_not_exists on both sides", "SET n = if_not_exists(n, :one) - if_not_exists(q, :one)", {
		values: one,
	}),
	updateScenario("parenthesised arithmetic", "SET n = (n + :one)", { values: one }),
	updateScenario("a parenthesised value", "SET q = (:v)", { values: { ":v": "x" } }),
	updateScenario("redundant parentheses are rejected", "SET q = ((:v))", { values: { ":v": "x" } }, "ValidationException"),
	updateScenario("three operands are a syntax error", "SET n = n + :one + :one", { values: one }, "ValidationException"),
	updateScenario(
		"arithmetic on a missing attribute is rejected",
		"SET q = q + :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario(
		"arithmetic on a NULL attribute is rejected",
		"SET nul = nul + :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario(
		"arithmetic on a string attribute is rejected",
		"SET s = s + :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario(
		"arithmetic with a string value is rejected",
		"SET n = n + :v",
		{ values: { ":v": "1" } },
		"ValidationException",
	),
	updateScenario(
		"subtraction with a string value is rejected",
		"SET q = :a - :b",
		{ values: { ":a": "1", ":b": 2 } },
		"ValidationException",
	),
	updateScenario("if_not_exists on a missing attribute", "SET q = if_not_exists(q, :one) + :one", { values: one }),
	updateScenario("if_not_exists on an existing attribute", "SET n = if_not_exists(n, :one) + :one", { values: one }),
	updateScenario(
		"if_not_exists keeps a NULL attribute, so arithmetic on it is rejected",
		"SET nul = if_not_exists(nul, :one) + :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario(
		"if_not_exists of a string attribute in arithmetic is rejected",
		"SET q = if_not_exists(s, :one) + :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario("if_not_exists on a nested path", "SET m.k = if_not_exists(m.zz, :one)", { values: one }),
	updateScenario(
		"if_not_exists requires a path first",
		"SET n = if_not_exists(:one, n)",
		{ values: one },
		"ValidationException",
	),
	updateScenario("if_not_exists rejects identical operands", "SET n = if_not_exists(n, n)", {}, "ValidationException"),
	updateScenario("list_append at the end", "SET l = list_append(l, :v)", { values: { ":v": ["w"] } }),
	updateScenario("list_append at the front", "SET l = list_append(:v, l)", { values: { ":v": ["w"] } }),
	updateScenario("list_append of two values", "SET q = list_append(:a, :b)", { values: { ":a": ["1"], ":b": ["2"] } }),
	updateScenario("list_append with if_not_exists", "SET q = list_append(if_not_exists(q, :e), :v)", {
		values: { ":v": ["w"], ":e": [] },
	}),
	updateScenario(
		"list_append on a missing attribute is rejected",
		"SET q = list_append(q, :v)",
		{ values: { ":v": ["w"] } },
		"ValidationException",
	),
	updateScenario(
		"list_append on a non-list attribute is rejected",
		"SET q = list_append(s, :v)",
		{ values: { ":v": ["w"] } },
		"ValidationException",
	),
	updateScenario(
		"list_append with a non-list value is rejected",
		"SET l = list_append(l, :v)",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"list_append inside arithmetic is rejected",
		"SET q = list_append(l, :e) + :one",
		{ values: { ":e": [], ...one } },
		"ValidationException",
	),
	updateScenario("size is not an update function", "SET q = size(s)", {}, "ValidationException"),
	updateScenario("unknown update functions are rejected", "SET q = foo(s)", {}, "ValidationException"),
	updateScenario("SET from another attribute", "SET q = s", {}),
	updateScenario(
		"SET from a missing attribute is rejected",
		"SET q = zz",
		{},
		"ValidationException",
	),
	updateScenario("SET reads the item as it was before the update", "SET s = :v, q = s", { values: { ":v": "w" } }),
	updateScenario("SET a nested map key", "SET m.k = :v", { values: { ":v": "w" } }),
	updateScenario("SET a new nested map key", "SET m.fresh = :v", { values: { ":v": "w" } }),
	updateScenario(
		"SET under a missing map is rejected",
		"SET zz.y = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"SET two levels under a missing key is rejected",
		"SET m.a.b = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"SET under a scalar is rejected",
		"SET s.y = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario("SET a list element", "SET l[1] = :v", { values: { ":v": "w" } }),
	updateScenario("SET past the end of a list appends", "SET l[7] = :v", { values: { ":v": "w" } }),
	updateScenario("appends land in index order", "SET l[6] = :v, l[5] = :w", { values: { ":v": "v", ":w": "w" } }),
	updateScenario(
		"SET with an index on a map is rejected",
		"SET m[0] = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario("SET a list element and REMOVE another (SET first)", "SET l[1] = :v REMOVE l[0]", {
		values: { ":v": "w" },
	}),
	updateScenario("SET an appended element and REMOVE the first", "SET l[5] = :v REMOVE l[0]", {
		values: { ":v": "w" },
	}),
	updateScenario("SET with a placeholder naming any characters", "SET #a = :v", {
		names: { "#a": "with-dash and space" },
		values: { ":v": "x" },
	}),
	updateScenario("REMOVE attributes", "REMOVE s, nul"),
	updateScenario("REMOVE a missing attribute", "REMOVE zz"),
	updateScenario("REMOVE list elements by their original index", "REMOVE l[0], l[2]"),
	updateScenario("REMOVE past the end of a list", "REMOVE l[9]"),
	updateScenario("REMOVE a nested key", "REMOVE m.deep.d"),
	updateScenario("REMOVE a missing nested key", "REMOVE m.zz"),
	updateScenario("REMOVE under a missing attribute is rejected", "REMOVE zz.y", {}, "ValidationException"),
	updateScenario("REMOVE an index of a missing list is rejected", "REMOVE zz[0]", {}, "ValidationException"),
	updateScenario("REMOVE an index of a map is rejected", "REMOVE m[0]", {}, "ValidationException"),
	updateScenario("REMOVE a key of a list is rejected", "REMOVE l.k", {}, "ValidationException"),
	updateScenario("ADD to a number", "ADD n :one", { values: one }),
	updateScenario("ADD creates a missing number", "ADD q :one", { values: one }),
	updateScenario("ADD to a NULL attribute is rejected", "ADD nul :one", { values: one }, "ValidationException"),
	updateScenario("ADD to a string attribute is rejected", "ADD s :one", { values: one }, "ValidationException"),
	updateScenario("ADD a string value is rejected", "ADD n :v", { values: { ":v": "1" } }, "ValidationException"),
	updateScenario("ADD to a string set", "ADD ss :v", { values: { ":v": new Set(["z", "x"]) } }),
	updateScenario("ADD to a number set", "ADD ns :v", { values: { ":v": new Set([2, 3]) } }),
	updateScenario(
		"ADD a number set to a string set is rejected",
		"ADD ss :v",
		{ values: { ":v": new Set([1]) } },
		"ValidationException",
	),
	updateScenario("ADD to a new nested key", "ADD m.tally :one", { values: one }),
	updateScenario("reserved words are rejected in nested paths", "ADD m.counter :one", { values: one }, "ValidationException"),
	updateScenario("ADD to a list element", "ADD l[1] :one", { values: one }),
	updateScenario(
		"ADD under a missing attribute is rejected",
		"ADD q.c :one",
		{ values: one },
		"ValidationException",
	),
	updateScenario("DELETE from a string set", "DELETE ss :v", { values: { ":v": new Set(["x", "q"]) } }),
	updateScenario("DELETE every member removes the attribute", "DELETE ss :v", {
		values: { ":v": new Set(["x", "y"]) },
	}),
	updateScenario("DELETE from a number set", "DELETE ns :v", { values: { ":v": new Set([1]) } }),
	updateScenario("DELETE from a missing attribute", "DELETE q :v", { values: { ":v": new Set(["a"]) } }),
	updateScenario(
		"DELETE a set of another type is rejected",
		"DELETE ss :v",
		{ values: { ":v": new Set([1]) } },
		"ValidationException",
	),
	updateScenario(
		"DELETE from a non-set attribute is rejected",
		"DELETE s :v",
		{ values: { ":v": new Set(["a"]) } },
		"ValidationException",
	),
	updateScenario(
		"DELETE a non-set value is rejected",
		"DELETE ss :v",
		{ values: { ":v": "x" } },
		"ValidationException",
	),
	updateScenario(
		"SET on a key attribute is rejected",
		"SET id = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario("REMOVE on a key attribute is rejected", "REMOVE id", {}, "ValidationException"),
	updateScenario(
		"overlapping paths are rejected",
		"SET m.k = :v REMOVE m",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"the same path twice is rejected",
		"SET s = :v, s = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"the same list element in SET and REMOVE is rejected",
		"SET l[0] = :v REMOVE l[0]",
		{ values: { ":v": "w" } },
		"ValidationException",
	),
	updateScenario(
		"ADD and DELETE on one set is rejected",
		"ADD ss :v DELETE ss :v",
		{ values: { ":v": new Set(["a"]) } },
		"ValidationException",
	),
	updateScenario(
		"a clause keyword may appear once",
		"SET s = :v SET n = :one",
		{ values: { ":v": "w", ...one } },
		"ValidationException",
	),
	updateScenario("clause keywords are case-insensitive", "set s = :v", { values: { ":v": "w" } }),
	updateScenario("clauses in any order", "REMOVE nul SET s = :v ADD n :one", { values: { ":v": "w", ...one } }),
	updateScenario("assignments separated by a comma without space", "SET s = :v,n = :one", {
		values: { ":v": "w", ...one },
	}),
	updateScenario("a clause keyword alone is a syntax error", "SET", {}, "ValidationException"),
	updateScenario("a trailing comma is a syntax error", "SET q = :v,", { values: { ":v": "x" } }, "ValidationException"),
	updateScenario("an empty update expression is rejected", "", {}, "ValidationException"),
	updateScenario(
		"an unused value placeholder is rejected",
		"SET s = :v",
		{ values: { ":v": "w", ":x": "1" } },
		"ValidationException",
	),
	updateScenario(
		"an unused name placeholder is rejected",
		"SET q = :v",
		{ values: { ":v": "x" }, names: { "#x": "q" } },
		"ValidationException",
	),
	updateScenario(
		"placeholders without any expression are rejected",
		undefined,
		{ values: { ":v": "x" } },
		"ValidationException",
	),
	updateScenario(
		"a secondary-index key of the wrong type is rejected",
		"SET gp = :v",
		{ values: { ":v": 1 } },
		"ValidationException",
	),
	updateScenario(
		"an empty string secondary-index key is rejected",
		"SET gp = :v",
		{ values: { ":v": "" } },
		"ValidationException",
	),
	updateScenario("an empty string attribute is accepted", "SET s = :v", { values: { ":v": "" } }),
	updateScenario("REMOVE a secondary-index key", "REMOVE gp"),
	updateScenario("a condition that holds", "SET s = :v", { values: { ":v": "w" }, names: { "#k": "id" } }, "ok", {
		ConditionExpression: "attribute_exists(#k)",
	}),
	updateScenario(
		"a condition that fails",
		"SET s = :v",
		{ values: { ":v": "w" }, names: { "#k": "id" } },
		"ConditionalCheckFailedException",
		{ ConditionExpression: "attribute_not_exists(#k)" },
	),
	updateScenario(
		"a failed condition wins over a runtime error of the update",
		"SET q = q + :one",
		{ values: one, names: { "#k": "id" } },
		"ConditionalCheckFailedException",
		{ ConditionExpression: "attribute_not_exists(#k)" },
	),
	updateScenario(
		"a statically invalid condition is a ValidationException",
		"SET s = :v",
		{ values: { ":v": "w", ":b": true } },
		"ValidationException",
		{ ConditionExpression: "n < :b" },
	),
	updateScenario("UpdateItem creates a missing item", "SET s = :v", { values: { ":v": "w" } }, "ok", {
		Key: { id: "new" },
	}),
	updateScenario("ADD on a missing item", "ADD n :one", { values: one }, "ok", { Key: { id: "new" } }),
	updateScenario("REMOVE on a missing item creates it with its key", "REMOVE n", {}, "ok", { Key: { id: "new" } }),
	updateScenario(
		"a nested SET on a missing item is rejected",
		"SET m.c = :v",
		{ values: { ":v": "x" } },
		"ValidationException",
		{ Key: { id: "new" } },
	),
	updateScenario(
		"a condition on a missing item sees no attributes",
		"SET q = :v",
		{ values: { ":v": "x" } },
		"ok",
		{ Key: { id: "new" }, ConditionExpression: "attribute_not_exists(id) AND q <> :v" },
	),
	updateScenario(
		"attribute_exists on the key of a missing item fails",
		"SET s = :v",
		{ values: { ":v": "w" }, names: { "#k": "id" } },
		"ConditionalCheckFailedException",
		{ Key: { id: "new" }, ConditionExpression: "attribute_exists(#k)" },
	),
	updateScenario("ReturnValues ALL_OLD", "SET s = :v", { values: { ":v": "w" } }, "ok", { ReturnValues: "ALL_OLD" }),
	updateScenario("ReturnValues ALL_OLD on a created item", "SET s = :v", { values: { ":v": "w" } }, "ok", {
		ReturnValues: "ALL_OLD",
		Key: { id: "new" },
	}),
	updateScenario("ReturnValues NONE", "SET s = :v", { values: { ":v": "w" } }, "ok", { ReturnValues: "NONE" }),
	updateScenario("a Key of the wrong type is rejected", "SET s = :v", { values: { ":v": "w" } }, "ValidationException", {
		Key: { id: 1 },
	}),
	updateScenario(
		"a Key with an extra attribute is rejected",
		"SET s = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
		{ Key: { id: "k", x: "1" } },
	),
	updateScenario(
		"a Key without the key attribute is rejected",
		"SET s = :v",
		{ values: { ":v": "w" } },
		"ValidationException",
		{ Key: { gp: "p" } },
	),
];

// Update expressions exactly as the adapter's buildPatchUpdateExpression
// emits them for update / updateMany.
const patchScenario = (
	name: string,
	prev: Item,
	next: Item,
	expected: ExpectedOutcome = "ok",
): Scenario => {
	const patch = buildPatchUpdateExpression({ prev, next });
	return {
		name: `adapter patch update: ${name} (${patch.updateExpression})`,
		seed: { items: [prev] },
		steps: [
			send(
				(tables) =>
					new UpdateCommand({
						TableName: tables.items,
						Key: { id: prev.id },
						UpdateExpression: patch.updateExpression,
						ExpressionAttributeNames: patch.expressionAttributeNames,
						ExpressionAttributeValues: patch.expressionAttributeValues,
						ReturnValues: "ALL_NEW",
					}),
			),
		],
		expected,
	};
};

const PATCH_SCENARIOS: Scenario[] = [
	patchScenario(
		"scalar changes, a removal, and a number delta",
		{ id: "p1", name: "a", count: 1, gone: "x", flag: false },
		{ id: "p1", name: "b", count: 4, flag: true },
	),
	patchScenario(
		"nested map changes",
		{ id: "p2", meta: { a: 1, b: { c: "x", d: "y" } } },
		{ id: "p2", meta: { a: 1, b: { c: "z" }, e: "new" } },
	),
	// A removal-only patch has no values, and `ExpressionAttributeValues: {}`
	// is rejected by DynamoDB ("ExpressionAttributeValues must not be empty").
	patchScenario(
		"a removal-only patch sends an empty ExpressionAttributeValues map",
		{ id: "p3", tags: ["a", "b", "c"] },
		{ id: "p3", tags: ["a"] },
		"ValidationException",
	),
	patchScenario("an array that grows", { id: "p4", tags: ["a"] }, { id: "p4", tags: ["a", "b", "c"] }),
	patchScenario("an array element changes and the array shrinks", { id: "p5", tags: ["a", "b", "c"] }, { id: "p5", tags: ["x", "b"] }),
	patchScenario("numbers inside an array", { id: "p6", scores: [1, 2] }, { id: "p6", scores: [3, 2] }),
	patchScenario("a value replaced by another type", { id: "p7", v: "1", w: null }, { id: "p7", v: 1, w: { x: 1 } }),
	patchScenario("a new attribute", { id: "p8" }, { id: "p8", fresh: "v", list: [1], map: { k: "v" } }),
];

// ---------------------------------------------------------------------------
// The atomic methods' requests (consumeOne / incrementOne)
// ---------------------------------------------------------------------------

const ATOMIC_ROW: Item = { id: "row", identifier: "abc", value: "v", count: 2, loginCount: 1 };
const NULL_COUNTER_ROW: Item = { id: "row", identifier: "abc", value: "v", count: 2, loginCount: null };

const incrementRequest = (props: {
	tables: Tables;
	where: DynamoDBWhere[];
	snapshot: Item;
	increment: Record<string, number>;
	set?: Record<string, unknown> | undefined;
}): UpdateCommand => {
	const expression = buildIncrementExpression({
		snapshot: props.snapshot,
		assignments: resolveIncrementAssignments({ increment: props.increment, set: props.set }),
	});
	return new UpdateCommand({
		TableName: props.tables.items,
		Key: { id: props.snapshot.id },
		UpdateExpression: expression.updateExpression,
		...buildConditionInput(
			buildAtomicCondition({
				model: "items",
				where: props.where,
				primaryKeyName: "id",
				getFieldName,
				snapshot: props.snapshot,
			}),
			{
				conditions: expression.counterConditions,
				expressionAttributeNames: expression.expressionAttributeNames,
				expressionAttributeValues: expression.expressionAttributeValues,
			},
		),
		ReturnValues: "ALL_NEW",
	});
};

const consumeRequest = (props: {
	tables: Tables;
	key: string;
	where: DynamoDBWhere[];
	snapshot?: Item | undefined;
}): DeleteCommand =>
	new DeleteCommand({
		TableName: props.tables.items,
		Key: { id: props.key },
		...buildConditionInput(
			buildAtomicCondition({
				model: "items",
				where: props.where,
				primaryKeyName: "id",
				getFieldName,
				snapshot: props.snapshot,
			}),
		),
		ReturnValues: "ALL_OLD",
	});

const WHERE_VALUE_AND_COUNT: DynamoDBWhere[] = [
	{ field: "id", operator: "eq", value: "row" },
	{ field: "count", operator: "lt", value: 5 },
];

const ATOMIC_SCENARIOS: Scenario[] = [
	{
		name: "incrementOne: counter that holds a number (SET #inc0 = if_not_exists(#inc0, :zero) + :inc0, #set0 = :set0)",
		seed: { items: [ATOMIC_ROW] },
		steps: [
			send((tables) =>
				incrementRequest({
					tables,
					where: WHERE_VALUE_AND_COUNT,
					snapshot: ATOMIC_ROW,
					increment: { loginCount: 2 },
					set: { value: "w" },
				}),
			),
		],
		expected: "ok",
	},
	{
		name: "incrementOne: missing counter starts from zero",
		seed: { items: [{ id: "row", identifier: "abc", value: "v", count: 2 }] },
		steps: [
			send((tables) =>
				incrementRequest({
					tables,
					where: WHERE_VALUE_AND_COUNT,
					snapshot: { id: "row", identifier: "abc", value: "v", count: 2 },
					increment: { loginCount: 3 },
				}),
			),
		],
		expected: "ok",
	},
	{
		name: "incrementOne: NULL counter (SET #inc0 = :inc0 guarded by attribute_type NULL)",
		seed: { items: [NULL_COUNTER_ROW] },
		steps: [
			send((tables) =>
				incrementRequest({ tables, where: WHERE_VALUE_AND_COUNT, snapshot: NULL_COUNTER_ROW, increment: { loginCount: 1 } }),
			),
		],
		expected: "ok",
	},
	{
		name: "incrementOne: a NULL counter breaks the condition built for a number counter",
		seed: { items: [NULL_COUNTER_ROW] },
		steps: [
			send((tables) =>
				incrementRequest({ tables, where: WHERE_VALUE_AND_COUNT, snapshot: ATOMIC_ROW, increment: { loginCount: 1 } }),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "incrementOne: a row that stopped matching the where clause is not incremented",
		seed: { items: [{ ...ATOMIC_ROW, count: 9 }] },
		steps: [
			send((tables) =>
				incrementRequest({ tables, where: WHERE_VALUE_AND_COUNT, snapshot: ATOMIC_ROW, increment: { loginCount: 1 } }),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "incrementOne: a deleted row is not recreated (attribute_exists(#pk))",
		seed: { items: [] },
		steps: [
			send((tables) =>
				incrementRequest({ tables, where: WHERE_VALUE_AND_COUNT, snapshot: ATOMIC_ROW, increment: { loginCount: 1 } }),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "incrementOne: client-only operators pin every field to the snapshot",
		seed: { items: [ATOMIC_ROW] },
		steps: [
			send((tables) =>
				incrementRequest({
					tables,
					where: [
						{ field: "id", operator: "eq", value: "row" },
						{ field: "identifier", operator: "ends_with", value: "bc" },
						{ field: "missingField", operator: "eq", value: "x", connector: "OR" },
					],
					snapshot: ATOMIC_ROW,
					increment: { loginCount: -1, count: 1 },
				}),
			),
		],
		expected: "ok",
	},
	{
		name: "incrementOne: a pinned field that changed fails the condition",
		seed: { items: [{ ...ATOMIC_ROW, identifier: "xbc" }] },
		steps: [
			send((tables) =>
				incrementRequest({
					tables,
					where: [{ field: "identifier", operator: "ends_with", value: "bc" }],
					snapshot: ATOMIC_ROW,
					increment: { loginCount: 1 },
				}),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "consumeOne: conditional delete by primary key returns the old item",
		seed: { items: [ATOMIC_ROW] },
		steps: [
			send((tables) =>
				consumeRequest({
					tables,
					key: "row",
					where: [
						{ field: "id", operator: "eq", value: "row" },
						{ field: "value", operator: "eq", value: "v" },
					],
				}),
			),
		],
		expected: "ok",
	},
	{
		name: "consumeOne: a row that does not match is not deleted",
		seed: { items: [ATOMIC_ROW] },
		steps: [
			send((tables) =>
				consumeRequest({
					tables,
					key: "row",
					where: [
						{ field: "id", operator: "eq", value: "row" },
						{ field: "value", operator: "ne", value: "v" },
					],
				}),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "consumeOne: a missing row fails the condition",
		seed: { items: [] },
		steps: [
			send((tables) =>
				consumeRequest({ tables, key: "row", where: [{ field: "id", operator: "eq", value: "row" }] }),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
	{
		name: "consumeOne: client-only where clause pins fields (attribute_not_exists for absent ones)",
		seed: { items: [ATOMIC_ROW] },
		steps: [
			send((tables) =>
				consumeRequest({
					tables,
					key: "row",
					where: [
						{ field: "identifier", operator: "ends_with", value: "bc" },
						{ field: "absent", operator: "eq", value: "x", connector: "OR" },
					],
					snapshot: ATOMIC_ROW,
				}),
			),
		],
		expected: "ok",
	},
	{
		name: "consumeOne: an absent pinned field that appeared fails the condition",
		seed: { items: [{ ...ATOMIC_ROW, absent: "now" }] },
		steps: [
			send((tables) =>
				consumeRequest({
					tables,
					key: "row",
					where: [
						{ field: "identifier", operator: "ends_with", value: "bc" },
						{ field: "absent", operator: "eq", value: "x", connector: "OR" },
					],
					snapshot: ATOMIC_ROW,
				}),
			),
		],
		expected: "ConditionalCheckFailedException",
	},
];

// ---------------------------------------------------------------------------
// Put / Delete / Get
// ---------------------------------------------------------------------------

const KEYED_SEED: Item[] = [
	{ id: "1", v: 1, gp: "p", gs: "a" },
	{ id: "2", v: 2 },
];

const keyedScenario = (name: string, step: Step, expected: ExpectedOutcome = "ok"): Scenario => ({
	name,
	seed: { items: KEYED_SEED },
	steps: [step],
	expected,
});

const ITEM_SCENARIOS: Scenario[] = [
	keyedScenario(
		"put: replaces an item and returns ALL_OLD",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "1", v: 9 }, ReturnValues: "ALL_OLD" })),
	),
	keyedScenario(
		"put: ALL_OLD of a new item is empty",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", v: 9 }, ReturnValues: "ALL_OLD" })),
	),
	keyedScenario(
		"put: ALL_NEW is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "1", v: 9 }, ReturnValues: "ALL_NEW" })),
		"ValidationException",
	),
	keyedScenario(
		"put: attribute_not_exists condition on an existing item fails",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "1", v: 9 },
					ConditionExpression: "attribute_not_exists(id)",
				}),
		),
		"ConditionalCheckFailedException",
	),
	keyedScenario(
		"put: attribute_not_exists condition on a new item holds",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "9", v: 9 },
					ConditionExpression: "attribute_not_exists(id)",
				}),
		),
	),
	keyedScenario(
		"put: condition with placeholders",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "1", v: 3 },
					ConditionExpression: "#v < :v",
					ExpressionAttributeNames: { "#v": "v" },
					ExpressionAttributeValues: { ":v": 3 },
				}),
		),
	),
	keyedScenario(
		"put: placeholders without a condition are rejected",
		send(
			(tables) =>
				new PutCommand({ TableName: tables.items, Item: { id: "9" }, ExpressionAttributeValues: { ":v": 3 } }),
		),
		"ValidationException",
	),
	keyedScenario(
		"put: an item without its key is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { v: 9 } })),
		"ValidationException",
	),
	keyedScenario(
		"put: a key of the wrong type is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: 9 } })),
		"ValidationException",
	),
	keyedScenario(
		"put: an empty string key is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "" } })),
		"ValidationException",
	),
	keyedScenario(
		"put: an empty string secondary-index key is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", gp: "" } })),
		"ValidationException",
	),
	keyedScenario(
		"put: a NULL secondary-index key is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", gp: null } })),
		"ValidationException",
	),
	keyedScenario(
		"put: a secondary-index key of the wrong type is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", nn: "1" } })),
		"ValidationException",
	),
	keyedScenario(
		"put: an item with every attribute type",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: {
						id: "9",
						s: "s",
						n: NumberValue.from("1.50"),
						b: new Uint8Array([0, 255]),
						t: true,
						z: null,
						l: [1, "a", [null]],
						m: { a: { b: [] } },
						ss: new Set(["a"]),
						ns: new Set([1.5]),
						bs: new Set([new Uint8Array([1])]),
						empty: "",
					},
				}),
		),
	),
	keyedScenario(
		"put: undefined attributes are removed by the document client",
		send(
			(tables) =>
				new PutCommand({ TableName: tables.items, Item: { id: "9", gone: undefined, m: { x: undefined, y: 1 } } }),
		),
	),
	keyedScenario(
		"put: a number with 38 significant digits",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "9", n: NumberValue.from(`1.${"2".repeat(37)}`) },
				}),
		),
	),
	keyedScenario(
		"put: a number with 39 significant digits is rejected",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "9", n: NumberValue.from(`1.${"2".repeat(38)}`) },
				}),
		),
		"ValidationException",
	),
	keyedScenario(
		"put: trailing zeros do not count as significant digits",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "9", n: NumberValue.from(`${"7".repeat(38)}00`) },
				}),
		),
	),
	keyedScenario(
		"put: leading zeros do not count as significant digits",
		send(
			(tables) =>
				new PutCommand({
					TableName: tables.items,
					Item: { id: "9", n: NumberValue.from(`0.0000${"3".repeat(38)}`) },
				}),
		),
	),
	keyedScenario(
		"put: a number above 9.99E+125 is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", n: NumberValue.from("1E+126") } })),
		"ValidationException",
	),
	keyedScenario(
		"put: a number below 1E-130 is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "9", n: NumberValue.from("1E-131") } })),
		"ValidationException",
	),
	{
		// The item is deleted again: a document client cannot unmarshall these
		// numbers into JavaScript numbers when the table is read back.
		name: "put: the smallest and largest magnitudes are accepted",
		seed: { items: KEYED_SEED },
		steps: [
			send(
				(tables) =>
					new PutCommand({
						TableName: tables.items,
						Item: { id: "9", lo: NumberValue.from("-1E-130"), hi: NumberValue.from(`9.${"9".repeat(37)}E+125`) },
					}),
			),
			send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "9" } })),
		],
		expected: "ok",
	},
	keyedScenario(
		"put: ReturnValues UPDATED_OLD is rejected",
		send((tables) => new PutCommand({ TableName: tables.items, Item: { id: "1" }, ReturnValues: "UPDATED_OLD" })),
		"ValidationException",
	),
	keyedScenario(
		"delete: ReturnValues UPDATED_NEW is rejected",
		send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "1" }, ReturnValues: "UPDATED_NEW" })),
		"ValidationException",
	),
	keyedScenario(
		"delete: returns ALL_OLD",
		send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "1" }, ReturnValues: "ALL_OLD" })),
	),
	keyedScenario(
		"delete: ALL_OLD of a missing item is empty",
		send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "9" }, ReturnValues: "ALL_OLD" })),
	),
	keyedScenario(
		"delete: ALL_NEW is rejected",
		send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "1" }, ReturnValues: "ALL_NEW" })),
		"ValidationException",
	),
	keyedScenario(
		"delete: attribute_exists on a missing item fails",
		send(
			(tables) =>
				new DeleteCommand({
					TableName: tables.items,
					Key: { id: "9" },
					ConditionExpression: "attribute_exists(id)",
				}),
		),
		"ConditionalCheckFailedException",
	),
	keyedScenario(
		"delete: a condition that holds",
		send(
			(tables) =>
				new DeleteCommand({
					TableName: tables.items,
					Key: { id: "1" },
					ConditionExpression: "v = :v",
					ExpressionAttributeValues: { ":v": 1 },
				}),
		),
	),
	keyedScenario(
		"delete: a condition that fails",
		send(
			(tables) =>
				new DeleteCommand({
					TableName: tables.items,
					Key: { id: "1" },
					ConditionExpression: "v = :v",
					ExpressionAttributeValues: { ":v": 2 },
				}),
		),
		"ConditionalCheckFailedException",
	),
	keyedScenario(
		"delete: a statically invalid condition",
		send(
			(tables) =>
				new DeleteCommand({
					TableName: tables.items,
					Key: { id: "1" },
					ConditionExpression: "v < :v",
					ExpressionAttributeValues: { ":v": true },
				}),
		),
		"ValidationException",
	),
	keyedScenario(
		"delete: placeholders without a condition are rejected",
		send(
			(tables) =>
				new DeleteCommand({ TableName: tables.items, Key: { id: "1" }, ExpressionAttributeValues: { ":v": 2 } }),
		),
		"ValidationException",
	),
	keyedScenario(
		"delete: a missing item without a condition succeeds",
		send((tables) => new DeleteCommand({ TableName: tables.items, Key: { id: "9" } })),
	),
	keyedScenario(
		"get: an existing item (ConsistentRead)",
		send((tables) => new GetCommand({ TableName: tables.items, Key: { id: "1" }, ConsistentRead: true })),
	),
	keyedScenario("get: a missing item", send((tables) => new GetCommand({ TableName: tables.items, Key: { id: "9" } }))),
	keyedScenario(
		"get: a Key without the key attribute is rejected",
		send((tables) => new GetCommand({ TableName: tables.items, Key: { gp: "p" } })),
		"ValidationException",
	),
	keyedScenario(
		"get: a Key with an extra attribute is rejected",
		send((tables) => new GetCommand({ TableName: tables.items, Key: { id: "1", v: 1 } })),
		"ValidationException",
	),
	keyedScenario(
		"get: an empty string key is rejected",
		send((tables) => new GetCommand({ TableName: tables.items, Key: { id: "" } })),
		"ValidationException",
	),
	keyedScenario(
		"get: a key of the wrong type is rejected",
		send((tables) => new GetCommand({ TableName: tables.items, Key: { id: 1 } })),
		"ValidationException",
	),
];

// ---------------------------------------------------------------------------
// Query / Scan
// ---------------------------------------------------------------------------

const QUERY_SEED: Item[] = [
	{ id: "1", gp: "p", gs: "b", v: 1 },
	{ id: "2", gp: "p", gs: "a", v: 2 },
	{ id: "3", gp: "p", gs: "c", v: 3 },
	{ id: "4", gp: "q", gs: "a", v: 4 },
	{ id: "5", gp: "p", v: 5 },
	{ id: "6", v: 6 },
	{ id: "7", np: "z", nn: 10 },
	{ id: "8", np: "z", nn: 2 },
	{ id: "9", np: "z", nn: -1.5 },
];

const COMPOSITE_SEED: Item[] = [
	{ pk: "a", sk: 1, v: "a1" },
	{ pk: "a", sk: 10, v: "a10" },
	{ pk: "a", sk: 2, v: "a2" },
	{ pk: "b", sk: 1, v: "b1" },
];

type QueryInput = ConstructorParameters<typeof QueryCommand>[0];
type ScanInput = ConstructorParameters<typeof ScanCommand>[0];

const queryScenario = (
	name: string,
	input: Omit<QueryInput, "TableName">,
	expected: ExpectedOutcome = "ok",
): Scenario => ({
	name: `query: ${name}`,
	seed: { items: QUERY_SEED, composite: COMPOSITE_SEED },
	steps: [send((tables) => new QueryCommand({ TableName: tables.items, ...input }))],
	expected,
});

const compositeQueryScenario = (
	name: string,
	input: Omit<QueryInput, "TableName">,
	expected: ExpectedOutcome = "ok",
): Scenario => ({
	name: `query (composite table key): ${name}`,
	seed: { items: QUERY_SEED, composite: COMPOSITE_SEED },
	steps: [send((tables) => new QueryCommand({ TableName: tables.composite, ...input }))],
	expected,
});

const scanScenario = (name: string, input: Omit<ScanInput, "TableName">, expected: ExpectedOutcome = "ok"): Scenario => ({
	name: `scan: ${name}`,
	seed: { items: QUERY_SEED, composite: COMPOSITE_SEED },
	steps: [send((tables) => new ScanCommand({ TableName: tables.items, ...input }))],
	expected,
});

const ON_P = {
	KeyConditionExpression: "#p = :p",
	ExpressionAttributeNames: { "#p": "gp" },
	ExpressionAttributeValues: { ":p": "p" },
};

const QUERY_SCENARIOS: Scenario[] = [
	queryScenario("sorted index, ascending", { IndexName: "gsi_sorted", ...ON_P }),
	queryScenario("sorted index, descending", { IndexName: "gsi_sorted", ...ON_P, ScanIndexForward: false }),
	queryScenario("Limit 1 returns a LastEvaluatedKey with index and table keys", {
		IndexName: "gsi_sorted",
		...ON_P,
		Limit: 1,
	}),
	queryScenario("a Limit that is reached exactly still returns a LastEvaluatedKey", {
		IndexName: "gsi_sorted",
		...ON_P,
		Limit: 3,
	}),
	queryScenario("a Limit above the result size", { IndexName: "gsi_sorted", ...ON_P, Limit: 4 }),
	queryScenario("ExclusiveStartKey, ascending", {
		IndexName: "gsi_sorted",
		...ON_P,
		ExclusiveStartKey: { id: "2", gp: "p", gs: "a" },
	}),
	queryScenario("ExclusiveStartKey, descending", {
		IndexName: "gsi_sorted",
		...ON_P,
		ScanIndexForward: false,
		ExclusiveStartKey: { id: "1", gp: "p", gs: "b" },
	}),
	queryScenario(
		"an ExclusiveStartKey from another partition is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, ExclusiveStartKey: { id: "4", gp: "q", gs: "a" } },
		"ValidationException",
	),
	queryScenario(
		"an ExclusiveStartKey outside the sort key condition is rejected",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p AND gs > :a",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p", ":a": "a" },
			ExclusiveStartKey: { id: "2", gp: "p", gs: "a" },
		},
		"ValidationException",
	),
	queryScenario("an ExclusiveStartKey of an item that does not exist", {
		IndexName: "gsi_sorted",
		...ON_P,
		ExclusiveStartKey: { id: "none", gp: "p", gs: "a5" },
	}),
	queryScenario(
		"an ExclusiveStartKey with a key of the wrong type is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, ExclusiveStartKey: { id: 1, gp: "p", gs: "a" } },
		"ValidationException",
	),
	queryScenario("an ExclusiveStartKey equal to the queried table key", {
		KeyConditionExpression: "id = :i",
		ExpressionAttributeValues: { ":i": "1" },
		ExclusiveStartKey: { id: "1" },
	}),
	queryScenario(
		"an ExclusiveStartKey without the index keys is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, ExclusiveStartKey: { id: "2" } },
		"ValidationException",
	),
	queryScenario("Limit applies before the filter", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "#p = :p",
		FilterExpression: "v = :v",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":v": 3 },
		Limit: 2,
	}),
	queryScenario("Select COUNT with a filter", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "#p = :p",
		FilterExpression: "v > :v",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":v": 1 },
		Select: "COUNT",
	}),
	queryScenario("Select COUNT with a Limit", { IndexName: "gsi_sorted", ...ON_P, Select: "COUNT", Limit: 2 }),
	queryScenario("Select ALL_ATTRIBUTES", { IndexName: "gsi_sorted", ...ON_P, Select: "ALL_ATTRIBUTES" }),
	queryScenario("an index without a sort key", { IndexName: "gsi_hash", ...ON_P }),
	queryScenario("an index without a sort key, descending", { IndexName: "gsi_hash", ...ON_P, ScanIndexForward: false }),
	queryScenario("a number sort key orders numerically", {
		IndexName: "gsi_number",
		KeyConditionExpression: "np = :z",
		ExpressionAttributeValues: { ":z": "z" },
	}),
	queryScenario("a number sort key, descending, with a range", {
		IndexName: "gsi_number",
		KeyConditionExpression: "np = :z AND nn >= :lo",
		ExpressionAttributeValues: { ":z": "z", ":lo": 0 },
		ScanIndexForward: false,
	}),
	queryScenario("sort key >", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "#p = :p AND gs > :a",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":a": "a" },
	}),
	queryScenario("sort key begins_with", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "#p = :p AND begins_with(gs, :a)",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":a": "b" },
	}),
	queryScenario("sort key BETWEEN, written before the partition key", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "gs BETWEEN :a AND :b AND #p = :p",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":a": "a", ":b": "b" },
	}),
	queryScenario("parenthesised key conditions", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "(#p = :p) AND (gs = :a)",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":a": "a" },
	}),
	queryScenario("a value before the key attribute", {
		KeyConditionExpression: ":i = id",
		ExpressionAttributeValues: { ":i": "1" },
	}),
	queryScenario("the table's own key", { KeyConditionExpression: "id = :i", ExpressionAttributeValues: { ":i": "1" } }),
	queryScenario("a table without a sort key returns no LastEvaluatedKey at Limit 1", {
		KeyConditionExpression: "id = :i",
		ExpressionAttributeValues: { ":i": "1" },
		Limit: 1,
	}),
	queryScenario("the table's own key with no match", {
		KeyConditionExpression: "id = :i",
		ExpressionAttributeValues: { ":i": "none" },
	}),
	queryScenario("a filter on the table key of an index query is allowed", {
		IndexName: "gsi_sorted",
		KeyConditionExpression: "#p = :p",
		FilterExpression: "id = :i",
		ExpressionAttributeNames: { "#p": "gp" },
		ExpressionAttributeValues: { ":p": "p", ":i": "1" },
	}),
	queryScenario("a filter on an index key of a table query is allowed", {
		KeyConditionExpression: "id = :i",
		FilterExpression: "gp = :p",
		ExpressionAttributeValues: { ":i": "1", ":p": "p" },
	}),
	queryScenario(
		"a filter on the partition key is rejected",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p",
			FilterExpression: "#p = :p",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p" },
		},
		"ValidationException",
	),
	queryScenario(
		"a filter on the sort key is rejected even when the key condition does not use it",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p",
			FilterExpression: "gs = :a",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p", ":a": "a" },
		},
		"ValidationException",
	),
	queryScenario(
		"a filter on a key attribute through a placeholder is rejected",
		{
			KeyConditionExpression: "id = :i",
			FilterExpression: "#k = :i",
			ExpressionAttributeNames: { "#k": "id" },
			ExpressionAttributeValues: { ":i": "1" },
		},
		"ValidationException",
	),
	queryScenario(
		"a filter on a nested path under a key attribute is rejected",
		{ KeyConditionExpression: "id = :i", FilterExpression: "id.x = :i", ExpressionAttributeValues: { ":i": "1" } },
		"ValidationException",
	),
	queryScenario(
		"a value used only by the filter counts as used",
		{
			KeyConditionExpression: "id = :i",
			FilterExpression: "v = :v",
			ExpressionAttributeValues: { ":i": "1", ":v": 1 },
		},
	),
	queryScenario(
		"OR in a key condition is rejected",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p OR gs = :a",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p", ":a": "a" },
		},
		"ValidationException",
	),
	queryScenario(
		"NOT in a key condition is rejected",
		{ KeyConditionExpression: "NOT id = :i", ExpressionAttributeValues: { ":i": "1" } },
		"ValidationException",
	),
	queryScenario(
		"<> in a key condition is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, KeyConditionExpression: "#p <> :p" },
		"ValidationException",
	),
	queryScenario(
		"IN in a key condition is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, KeyConditionExpression: "#p IN (:p)" },
		"ValidationException",
	),
	queryScenario(
		"contains in a key condition is rejected",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p AND contains(gs, :a)",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p", ":a": "a" },
		},
		"ValidationException",
	),
	queryScenario(
		"attribute_exists in a key condition is rejected",
		{ KeyConditionExpression: "attribute_exists(id)" },
		"ValidationException",
	),
	queryScenario(
		"size in a key condition is rejected",
		{ KeyConditionExpression: "size(id) = :n", ExpressionAttributeValues: { ":n": 1 } },
		"ValidationException",
	),
	queryScenario(
		"a key condition without the partition key is rejected",
		{ IndexName: "gsi_sorted", KeyConditionExpression: "gs = :a", ExpressionAttributeValues: { ":a": "a" } },
		"ValidationException",
	),
	queryScenario(
		"a key condition on a non-key attribute is rejected",
		{
			IndexName: "gsi_sorted",
			KeyConditionExpression: "#p = :p AND v = :v",
			ExpressionAttributeNames: { "#p": "gp" },
			ExpressionAttributeValues: { ":p": "p", ":v": 1 },
		},
		"ValidationException",
	),
	queryScenario(
		"a sort key condition on an index without a sort key is rejected",
		{
			IndexName: "gsi_hash",
			KeyConditionExpression: "gp = :p AND gs = :a",
			ExpressionAttributeValues: { ":p": "p", ":a": "a" },
		},
		"ValidationException",
	),
	queryScenario(
		"a range condition on the partition key is rejected",
		{ KeyConditionExpression: "id < :i", ExpressionAttributeValues: { ":i": "1" } },
		"ValidationException",
	),
	queryScenario(
		"begins_with on the partition key is rejected",
		{ KeyConditionExpression: "begins_with(id, :i)", ExpressionAttributeValues: { ":i": "1" } },
		"ValidationException",
	),
	queryScenario(
		"two conditions on one key are rejected",
		{ IndexName: "gsi_sorted", ...ON_P, KeyConditionExpression: "#p = :p AND #p = :p" },
		"ValidationException",
	),
	queryScenario(
		"two attribute names in one key condition are rejected",
		{ KeyConditionExpression: "id = gp" },
		"ValidationException",
	),
	queryScenario(
		"a nested key path is rejected",
		{ KeyConditionExpression: "id.x = :i", ExpressionAttributeValues: { ":i": "1" } },
		"ValidationException",
	),
	queryScenario(
		"a key value of the wrong type is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, ExpressionAttributeValues: { ":p": 1 } },
		"ValidationException",
	),
	queryScenario(
		"a sort key value of the wrong type is rejected",
		{
			IndexName: "gsi_number",
			KeyConditionExpression: "np = :z AND nn < :n",
			ExpressionAttributeValues: { ":z": "z", ":n": "1" },
		},
		"ValidationException",
	),
	queryScenario(
		"an unknown index is rejected",
		{ IndexName: "nope_idx", ...ON_P },
		"ValidationException",
	),
	queryScenario("Limit 0 is rejected", { ...ON_P, IndexName: "gsi_sorted", Limit: 0 }, "ValidationException"),
	queryScenario(
		"ConsistentRead on an index is rejected",
		{ IndexName: "gsi_sorted", ...ON_P, ConsistentRead: true },
		"ValidationException",
	),
	queryScenario(
		"an unused value in a query is rejected",
		{ KeyConditionExpression: "id = :i", ExpressionAttributeValues: { ":i": "1", ":j": "1" } },
		"ValidationException",
	),
	compositeQueryScenario("orders by the numeric sort key", {
		KeyConditionExpression: "pk = :a",
		ExpressionAttributeValues: { ":a": "a" },
	}),
	compositeQueryScenario("sort key BETWEEN, descending", {
		KeyConditionExpression: "pk = :a AND sk BETWEEN :lo AND :hi",
		ExpressionAttributeValues: { ":a": "a", ":lo": 2, ":hi": 10 },
		ScanIndexForward: false,
	}),
	compositeQueryScenario(
		"begins_with on a number sort key is rejected",
		{ KeyConditionExpression: "pk = :a AND begins_with(sk, :b)", ExpressionAttributeValues: { ":a": "a", ":b": "1" } },
		"ValidationException",
	),
	compositeQueryScenario("a full primary key lookup still returns a LastEvaluatedKey at its Limit", {
		KeyConditionExpression: "pk = :a AND sk = :one",
		ExpressionAttributeValues: { ":a": "a", ":one": 1 },
		Limit: 1,
	}),
	compositeQueryScenario("Limit and ExclusiveStartKey", {
		KeyConditionExpression: "pk = :a",
		ExpressionAttributeValues: { ":a": "a" },
		Limit: 2,
		ExclusiveStartKey: { pk: "a", sk: 1 },
	}),
	scanScenario("all items", {}),
	scanScenario("a filter on the key is allowed", { FilterExpression: "id = :i", ExpressionAttributeValues: { ":i": "1" } }),
	scanScenario("Limit returns a LastEvaluatedKey", { Limit: 2 }),
	scanScenario("a Limit equal to the item count still returns a LastEvaluatedKey", { Limit: 9 }),
	scanScenario("Select COUNT with a filter", {
		Select: "COUNT",
		FilterExpression: "v > :v",
		ExpressionAttributeValues: { ":v": 2 },
	}),
	scanScenario("Select COUNT with a Limit", { Select: "COUNT", Limit: 2 }),
	scanScenario("an index holds only items with its keys", { IndexName: "gsi_sorted" }),
	scanScenario("an ExclusiveStartKey without the key is rejected", { ExclusiveStartKey: { v: 1 } }, "ValidationException"),
	scanScenario(
		"an ExclusiveStartKey with an extra attribute is rejected",
		{ ExclusiveStartKey: { id: "1", v: 1 } },
		"ValidationException",
	),
	scanScenario(
		"placeholders without a filter are rejected",
		{ ExpressionAttributeValues: { ":v": 1 } },
		"ValidationException",
	),
	scanScenario("Limit 0 is rejected", { Limit: 0 }, "ValidationException"),
];

const PAGINATION_SCENARIOS: Scenario[] = [
	{
		name: "pagination: sorted index query, one item per page",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new QueryCommand({ TableName: tables.items, IndexName: "gsi_sorted", ...ON_P, Limit: 1, ExclusiveStartKey: exclusiveStartKey }),
				false,
			),
		],
		expected: "ok",
	},
	{
		name: "pagination: sorted index query, descending, two items per page",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new QueryCommand({
						TableName: tables.items,
						IndexName: "gsi_sorted",
						...ON_P,
						Limit: 2,
						ScanIndexForward: false,
						ExclusiveStartKey: exclusiveStartKey,
					}),
				false,
			),
		],
		expected: "ok",
	},
	{
		name: "pagination: number index query with a filter",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new QueryCommand({
						TableName: tables.items,
						IndexName: "gsi_number",
						KeyConditionExpression: "np = :z",
						FilterExpression: "id <> :eight",
						ExpressionAttributeValues: { ":z": "z", ":eight": "8" },
						Limit: 1,
						ExclusiveStartKey: exclusiveStartKey,
					}),
				false,
			),
		],
		expected: "ok",
	},
	{
		name: "pagination: index without a sort key, two items per page",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new QueryCommand({ TableName: tables.items, IndexName: "gsi_hash", ...ON_P, Limit: 2, ExclusiveStartKey: exclusiveStartKey }),
				true,
			),
		],
		expected: "ok",
	},
	{
		name: "pagination: scan, two items per page",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new ScanCommand({ TableName: tables.items, Limit: 2, ExclusiveStartKey: exclusiveStartKey }),
				true,
			),
		],
		expected: "ok",
	},
	{
		name: "pagination: scan with a filter, three items per page",
		seed: { items: QUERY_SEED },
		steps: [
			paginate(
				(tables, exclusiveStartKey) =>
					new ScanCommand({
						TableName: tables.items,
						FilterExpression: "attribute_exists(gp)",
						Limit: 3,
						ExclusiveStartKey: exclusiveStartKey,
					}),
				true,
			),
		],
		expected: "ok",
	},
];

// ---------------------------------------------------------------------------
// BatchGet
// ---------------------------------------------------------------------------

const BATCH_SCENARIOS: Scenario[] = [
	{
		name: "batch get: found and missing keys across two tables",
		seed: { items: QUERY_SEED, composite: COMPOSITE_SEED },
		steps: [
			send(
				(tables) =>
					new BatchGetCommand({
						RequestItems: {
							[tables.items]: { Keys: [{ id: "1" }, { id: "none" }, { id: "3" }], ConsistentRead: true },
							[tables.composite]: { Keys: [{ pk: "a", sk: 10 }, { pk: "z", sk: 1 }] },
						},
					}),
			),
		],
		expected: "ok",
	},
	{
		name: "batch get: duplicate keys are rejected",
		seed: { items: QUERY_SEED },
		steps: [send((tables) => new BatchGetCommand({ RequestItems: { [tables.items]: { Keys: [{ id: "1" }, { id: "1" }] } } }))],
		expected: "ValidationException",
	},
	{
		name: "batch get: an empty key list is rejected",
		seed: { items: QUERY_SEED },
		steps: [send((tables) => new BatchGetCommand({ RequestItems: { [tables.items]: { Keys: [] } } }))],
		expected: "ValidationException",
	},
	{
		name: "batch get: a key without the key attribute is rejected",
		seed: { items: QUERY_SEED },
		steps: [send((tables) => new BatchGetCommand({ RequestItems: { [tables.items]: { Keys: [{ gp: "p" }] } } }))],
		expected: "ValidationException",
	},
	{
		name: "batch get: more than 100 keys are rejected",
		seed: { items: QUERY_SEED },
		steps: [
			send(
				(tables) =>
					new BatchGetCommand({
						RequestItems: {
							[tables.items]: { Keys: Array.from({ length: 101 }, (_, index) => ({ id: `k${index}` })) },
						},
					}),
			),
		],
		expected: "ValidationException",
	},
];

// ---------------------------------------------------------------------------
// TransactWrite (raw commands and the adapter's executeTransaction)
// ---------------------------------------------------------------------------

const TRANSACTION_SEED: Item[] = [
	{ id: "1", v: 1, gp: "p", gs: "a" },
	{ id: "2", v: 2 },
];

const transactionScenario = (name: string, step: Step, expected: ExpectedOutcome): Scenario => ({
	name: `transact write: ${name}`,
	seed: { items: TRANSACTION_SEED },
	steps: [step],
	expected,
});

const TRANSACTION_SCENARIOS: Scenario[] = [
	transactionScenario(
		"Put, Update, and Delete commit together",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{ Put: { TableName: tables.items, Item: { id: "3", v: 3 } } },
						{
							Update: {
								TableName: tables.items,
								Key: { id: "1" },
								UpdateExpression: "ADD v :one",
								ExpressionAttributeValues: { ":one": 1 },
							},
						},
						{ Delete: { TableName: tables.items, Key: { id: "2" } } },
					],
				}),
		),
		"ok",
	),
	transactionScenario(
		"two operations on one item are rejected",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{ Put: { TableName: tables.items, Item: { id: "1", v: 3 } } },
						{ Delete: { TableName: tables.items, Key: { id: "1" } } },
					],
				}),
		),
		"ValidationException",
	),
	transactionScenario(
		"a failed condition cancels every operation with per-item reasons",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{ Put: { TableName: tables.items, Item: { id: "3", v: 3 } } },
						{
							Update: {
								TableName: tables.items,
								Key: { id: "1" },
								UpdateExpression: "ADD v :one",
								ConditionExpression: "v = :two",
								ExpressionAttributeValues: { ":one": 1, ":two": 2 },
							},
						},
						{ Delete: { TableName: tables.items, Key: { id: "2" } } },
					],
				}),
		),
		"TransactionCanceledException",
	),
	transactionScenario(
		"a failing ConditionCheck cancels the transaction",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: tables.items,
								Key: { id: "2" },
								ConditionExpression: "attribute_not_exists(id)",
							},
						},
						{ Delete: { TableName: tables.items, Key: { id: "1" } } },
					],
				}),
		),
		"TransactionCanceledException",
	),
	transactionScenario(
		"a ConditionCheck that holds lets the transaction commit",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{
							ConditionCheck: {
								TableName: tables.items,
								Key: { id: "2" },
								ConditionExpression: "attribute_exists(id)",
							},
						},
						{ Delete: { TableName: tables.items, Key: { id: "1" } } },
					],
				}),
		),
		"ok",
	),
	transactionScenario(
		"a runtime update error leaves every item unchanged",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{ Delete: { TableName: tables.items, Key: { id: "2" } } },
						{
							Update: {
								TableName: tables.items,
								Key: { id: "1" },
								UpdateExpression: "SET q = q + :one",
								ExpressionAttributeValues: { ":one": 1 },
							},
						},
					],
				}),
		),
		"ValidationException",
	),
	transactionScenario(
		"an invalid item rejects the whole request",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{ Delete: { TableName: tables.items, Key: { id: "2" } } },
						{
							Update: {
								TableName: tables.items,
								Key: { id: "1" },
								UpdateExpression: "SET v = :one",
								ExpressionAttributeValues: { ":one": 1, ":unused": 1 },
							},
						},
					],
				}),
		),
		"ValidationException",
	),
	transactionScenario(
		"an Update creates a missing item",
		send(
			(tables) =>
				new TransactWriteCommand({
					TransactItems: [
						{
							Update: {
								TableName: tables.items,
								Key: { id: "7" },
								UpdateExpression: "SET v = :one",
								ExpressionAttributeValues: { ":one": 1 },
							},
						},
					],
				}),
		),
		"ok",
	),
	transactionScenario(
		"an empty transaction is rejected",
		send(() => new TransactWriteCommand({ TransactItems: [] })),
		"ValidationException",
	),
	transactionScenario(
		"adapter executeTransaction: pinned delete, pinned update, guarded create and a condition check",
		transaction((state, tables) => {
			// consumeOne inside a transaction: delete the row that was read.
			const consumed = bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: TRANSACTION_SEED[1],
				next: null,
			});
			pinTransactionFields(consumed, Object.keys(TRANSACTION_SEED[1]));
			// incrementOne inside a transaction: counter and guard field pinned.
			const incremented = bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: TRANSACTION_SEED[0],
				next: { ...TRANSACTION_SEED[0], v: 6, gs: "b" },
			});
			pinTransactionFields(incremented, ["v"]);
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "3", v: 3 },
			});
		}),
		"ok",
	),
	transactionScenario(
		"adapter executeTransaction: a pinned row that ends up unchanged is condition-checked",
		transaction((state, tables) => {
			const guarded = bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: TRANSACTION_SEED[0],
				next: { ...TRANSACTION_SEED[0] },
			});
			pinTransactionFields(guarded, ["v", "missing"]);
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "3", v: 3 },
			});
		}),
		"ok",
	),
	transactionScenario(
		"adapter executeTransaction: a stale pinned row cancels the transaction",
		transaction((state, tables) => {
			const consumed = bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: { ...TRANSACTION_SEED[1], v: 7 },
				next: null,
			});
			pinTransactionFields(consumed, ["v"]);
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "3", v: 3 },
			});
		}),
		"TransactionCanceledException",
	),
	transactionScenario(
		"adapter executeTransaction: a stale condition check cancels the transaction",
		transaction((state, tables) => {
			const guarded = bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: { ...TRANSACTION_SEED[0], v: 7 },
				next: { ...TRANSACTION_SEED[0], v: 7 },
			});
			pinTransactionFields(guarded, ["v"]);
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "3", v: 3 },
			});
		}),
		"TransactionCanceledException",
	),
	transactionScenario(
		"adapter executeTransaction: creating a row whose key is taken cancels the transaction",
		transaction((state, tables) => {
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "1", v: 9 },
			});
			bufferTransactionCreate(state, {
				tableName: tables.items,
				keyField: "id",
				item: { id: "3", v: 3 },
			});
		}),
		"TransactionCanceledException",
	),
	transactionScenario(
		"adapter executeTransaction: updating a row that no longer exists cancels the transaction",
		transaction((state, tables) => {
			bufferTransactionWrite(state, {
				tableName: tables.items,
				keyField: "id",
				row: { id: "gone", v: 1 },
				next: { id: "gone", v: 2 },
			});
		}),
		"TransactionCanceledException",
	),
];

const ALL_SCENARIOS: Scenario[] = [
	...FILTER_SCENARIOS,
	...ADAPTER_FILTER_SCENARIOS,
	...UPDATE_SCENARIOS,
	...PATCH_SCENARIOS,
	...ATOMIC_SCENARIOS,
	...ITEM_SCENARIOS,
	...QUERY_SCENARIOS,
	...PAGINATION_SCENARIOS,
	...BATCH_SCENARIOS,
	...TRANSACTION_SCENARIOS,
];

describe("in-memory DynamoDB fake matches DynamoDB Local", () => {
	beforeAll(async () => {
		await applyTableSchemas({ client: realLowLevelClient, tables: CREATED_SCHEMAS });
	});

	afterAll(async () => {
		await deleteTables({ client: realLowLevelClient, tableNames: tableNamesFromSchemas(CREATED_SCHEMAS) });
	});

	test("scenario names are unique", () => {
		const names = ALL_SCENARIOS.map((scenario) => scenario.name);
		expect(new Set(names).size).toBe(names.length);
	});

	for (const scenario of ALL_SCENARIOS) {
		test(scenario.name, async () => {
			await clearRealTables();
			const real = await runScenario(realClient, scenario);
			const fake = await runScenario(createFakeClient().documentClient, scenario);

			expect(real.error?.name ?? "ok").toBe(scenario.expected);
			expect(fake).toEqual(real);
		});
	}
});

// ---------------------------------------------------------------------------
// The adapter's atomic methods end to end on both backends
// ---------------------------------------------------------------------------

const adapterOptions: BetterAuthOptions = {
	user: {
		additionalFields: {
			loginCount: { type: "number", required: false },
		},
	},
};

const adapterSchemas = generateTableSchemas(adapterOptions);
const adapterResolvers = createIndexResolversFromSchemas(adapterSchemas);
const adapterPrefix = `${tableNamePrefix}adapter_`;
const adapterTables = adapterSchemas.map((schema) => ({
	...schema,
	tableName: `${adapterPrefix}${schema.tableName}`,
}));
const adapterUserTable = `${adapterPrefix}user`;
const adapterVerificationTable = `${adapterPrefix}verification`;

const createAtomicAdapter = (documentClient: DynamoDBDocumentClient): DBTransactionAdapter<BetterAuthOptions> =>
	dynamodbAdapter({
		documentClient,
		tableNamePrefix: adapterPrefix,
		scanMaxPages: 25,
		indexNameResolver: adapterResolvers.indexNameResolver,
		indexKeySchemaResolver: adapterResolvers.indexKeySchemaResolver,
		transaction: false,
	})(adapterOptions);

type AdapterBackend = {
	documentClient: DynamoDBDocumentClient;
	sendCalls: unknown[] | undefined;
};

const runAtomicFlow = async (backend: AdapterBackend) => {
	const adapter = createAtomicAdapter(backend.documentClient);
	await backend.documentClient.send(
		new PutCommand({
			TableName: adapterUserTable,
			Item: {
				id: "user-1",
				name: "user",
				email: "user-1@example.com",
				emailVerified: false,
				loginCount: 1,
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		}),
	);
	for (const [index, identifier] of ["code-a", "code-a", "code-b"].entries()) {
		await backend.documentClient.send(
			new PutCommand({
				TableName: adapterVerificationTable,
				Item: {
					id: `verification-${index}`,
					identifier,
					value: `value-${index}`,
					expiresAt: "2100-01-01T00:00:00.000Z",
					createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
					updatedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
				},
			}),
		);
	}
	const incremented = await adapter.incrementOne({
		model: "user",
		where: [
			{ field: "id", value: "user-1" },
			{ field: "loginCount", operator: "lt", value: 5 },
		],
		increment: { loginCount: 2 },
	});
	const blocked = await adapter.incrementOne({
		model: "user",
		where: [
			{ field: "id", value: "user-1" },
			{ field: "loginCount", operator: "lt", value: 3 },
		],
		increment: { loginCount: 1 },
	});
	const consumedById = await adapter.consumeOne({
		model: "verification",
		where: [
			{ field: "id", value: "verification-2" },
			{ field: "value", value: "value-2" },
		],
	});
	const consumedByIdentifier = await adapter.consumeOne({
		model: "verification",
		where: [{ field: "identifier", value: "code-a" }],
	});
	const user = await backend.documentClient.send(
		new GetCommand({ TableName: adapterUserTable, Key: { id: "user-1" } }),
	);
	const verifications = await backend.documentClient.send(new ScanCommand({ TableName: adapterVerificationTable }));
	return {
		incremented,
		blocked,
		consumedById,
		consumedByIdentifier,
		storedUser: user.Item,
		remainingVerifications: sortItems(verifications.Items ?? []),
	};
};

describe("the adapter's atomic methods behave the same on the fake and on DynamoDB Local", () => {
	beforeAll(async () => {
		await applyTableSchemas({ client: realLowLevelClient, tables: adapterTables });
	});

	afterAll(async () => {
		await deleteTables({ client: realLowLevelClient, tableNames: tableNamesFromSchemas(adapterTables) });
	});

	test("incrementOne and consumeOne", async () => {
		const real = await runAtomicFlow({ documentClient: realClient, sendCalls: undefined });
		const fake = createStatefulDocumentClient({ tableSchemas: adapterSchemas, tableNamePrefix: adapterPrefix });
		const fakeResult = await runAtomicFlow({ documentClient: fake.documentClient, sendCalls: fake.sendCalls });

		expect(fakeResult).toEqual(real);
		// The fake applied the counter update instead of ignoring it:
		// 1 + 2 = 3, and the second call's `loginCount < 3` guard held it back.
		expect(fakeResult.storedUser?.loginCount).toBe(3);
		expect(fake.store.findByKey(adapterUserTable, { id: "user-1" })?.loginCount).toBe(3);
		expect(fakeResult.blocked).toBeNull();
		const conditionalUpdates = fake.sendCalls.filter(
			(call): call is UpdateCommand => call instanceof UpdateCommand,
		);
		expect(conditionalUpdates.map((call) => call.input.UpdateExpression)).toEqual([
			"SET #inc0 = if_not_exists(#inc0, :zero) + :inc0",
		]);
		expect(conditionalUpdates[0]?.input.ConditionExpression).toBe(
			"attribute_exists(#pk) AND (#f0 = :v0 AND #f1 < :v1) AND (attribute_not_exists(#inc0) OR attribute_type(#inc0, :numberType))",
		);
	});
});

// ---------------------------------------------------------------------------
// Constructs outside the emulation fail loudly
// ---------------------------------------------------------------------------

const captureError = async (fn: () => Promise<unknown>): Promise<unknown> => {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return undefined;
};

const UNSUPPORTED_REQUESTS: { name: string; command: () => unknown }[] = [
	{ name: "BatchWriteCommand", command: () => new BatchWriteCommand({ RequestItems: {} }) },
	{ name: "TransactGetCommand", command: () => new TransactGetCommand({ TransactItems: [] }) },
	{
		name: "GetItem ProjectionExpression",
		command: () => new GetCommand({ TableName: "t", Key: { id: "1" }, ProjectionExpression: "id" }),
	},
	{
		name: "Query ProjectionExpression",
		command: () =>
			new QueryCommand({
				TableName: "t",
				KeyConditionExpression: "id = :i",
				ExpressionAttributeValues: { ":i": "1" },
				ProjectionExpression: "id",
			}),
	},
	{ name: "Scan Segment", command: () => new ScanCommand({ TableName: "t", Segment: 0, TotalSegments: 2 }) },
	{ name: "Scan Select SPECIFIC_ATTRIBUTES", command: () => new ScanCommand({ TableName: "t", Select: "SPECIFIC_ATTRIBUTES" }) },
	{
		name: "UpdateItem ReturnValues UPDATED_NEW",
		command: () =>
			new UpdateCommand({
				TableName: "t",
				Key: { id: "1" },
				UpdateExpression: "SET a = :v",
				ExpressionAttributeValues: { ":v": 1 },
				ReturnValues: "UPDATED_NEW",
			}),
	},
	{
		name: "PutItem ReturnValuesOnConditionCheckFailure",
		command: () =>
			new PutCommand({
				TableName: "t",
				Item: { id: "1" },
				ConditionExpression: "attribute_not_exists(id)",
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			}),
	},
	{
		name: "legacy Expected parameter",
		command: () => new PutCommand({ TableName: "t", Item: { id: "1" }, Expected: { id: { Exists: false } } }),
	},
	{
		name: "TransactWriteItems ClientRequestToken",
		command: () =>
			new TransactWriteCommand({
				ClientRequestToken: "token",
				TransactItems: [{ Put: { TableName: "t", Item: { id: "1" } } }],
			}),
	},
];

const sendUnknown = (documentClient: DynamoDBDocumentClient, command: unknown): Promise<unknown> => {
	const send: (input: unknown) => Promise<unknown> = (input) => Reflect.apply(documentClient.send, documentClient, [input]);
	return send(command);
};

describe("the fake rejects requests it does not emulate", () => {
	for (const request of UNSUPPORTED_REQUESTS) {
		test(request.name, async () => {
			const { documentClient } = createStatefulDocumentClient();
			const error = await captureError(() => sendUnknown(documentClient, request.command()));

			expect(error).toBeInstanceOf(Error);
			expect(error).toHaveProperty("name", "FakeDynamoDBUnsupportedError");
		});
	}

	test("a low-level client command (DescribeTableCommand)", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const error = await captureError(() =>
			sendUnknown(documentClient, new DescribeTableCommand({ TableName: "t" })),
		);

		expect(error).toHaveProperty("name", "FakeDynamoDBUnsupportedError");
	});
});
