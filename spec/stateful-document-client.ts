/**
 * @file In-memory DynamoDB document client for integration tests.
 *
 * Emulates the subset of DynamoDB the adapter uses — GetItem, PutItem,
 * UpdateItem, DeleteItem, Query, Scan, BatchGetItem, TransactWriteItems — on
 * an in-memory store, with the expression language evaluated by
 * `spec/dynamodb-expression-evaluator.ts`. Items are stored as marshalled
 * `AttributeValue`s (translated with the document client's own
 * `marshallOptions` / `unmarshallOptions`), so type semantics match the real
 * engine. Its behaviour is checked against DynamoDB Local by
 * `spec/stateful-document-client.spec.ts`.
 *
 * Conditions are enforced (`ConditionalCheckFailedException`,
 * `TransactionCanceledException`), invalid requests are rejected
 * (`ValidationException`), and every request parameter, command, or
 * expression construct the fake does not emulate throws
 * `FakeDynamoDBUnsupportedError` instead of being ignored.
 *
 * Tables: a table is described by the same `TableSchema` the adapter's table
 * generator produces (`createStatefulDocumentClient({ tableSchemas,
 * tableNamePrefix })`), which gives the fake the key schema and the global
 * secondary indexes it needs for key validation, Query, sort order, and
 * pagination keys. A table name that was not declared is an implicit table
 * that exists, starts empty, and has the adapter's default key schema: a
 * string partition key `id` and no secondary index. A Query on an index that
 * was not declared is rejected like DynamoDB rejects an unknown index.
 *
 * Where DynamoDB Local and the DynamoDB service are known to differ, the
 * fake follows DynamoDB Local (the differential spec's reference): a
 * transaction whose update fails at run time is a ValidationException, and a
 * Query on a table without a sort key never returns a LastEvaluatedKey.
 *
 * Known limits of the emulation (none of them affects the result of a
 * request the adapter sends today):
 * - pages are cut only by `Limit`, never by the 1 MB response size limit;
 * - the order of a Scan, and of items that share a partition (and sort) key
 *   in an index, is the order of the table's primary key rather than
 *   DynamoDB's hash order;
 * - item size (400 KB) and capacity limits are not enforced;
 * - reads are always strongly consistent.
 */
import type {
	AttributeDefinition,
	AttributeValue,
	KeySchemaElement,
} from "@aws-sdk/client-dynamodb";
import {
	BatchGetCommand,
	DeleteCommand,
	GetCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
	UpdateCommand,
	type TransactWriteCommandInput,
	type TranslateConfig,
} from "@aws-sdk/lib-dynamodb";
import {
	marshall,
	unmarshall,
	type NativeAttributeValue,
} from "@aws-sdk/util-dynamodb";
import type { TableSchema } from "../src/dynamodb/types";
import {
	attributeTypeOf,
	cloneAttributeMap,
	compareOrderedValues,
	keyValueFingerprint,
	normalizeAttributeMap,
	type AttributeMap,
} from "./dynamodb-attribute-values";
import { createDocumentClientStub } from "./dynamodb-document-client";
import {
	applyUpdate,
	assertAllPlaceholdersUsed,
	assertValidKeyCondition,
	conditionPaths,
	createExpressionContext,
	evaluateCondition,
	parseCondition,
	parseUpdate,
	updatedTopLevelNames,
	type CompiledUpdate,
	type Condition,
	type ExpressionContext,
	type KeyAttributeDefinition,
	type KeySchemaDefinition,
} from "./dynamodb-expression-evaluator";
import {
	conditionalCheckFailed,
	transactionCanceled,
	unsupported,
	validationError,
	type CancellationReason,
} from "./dynamodb-fake-errors";

type StoreItem = Record<string, unknown>;

type InMemoryStore = {
	put: (tableName: string, item: StoreItem) => void;
	get: (tableName: string) => StoreItem[];
	findByKey: (
		tableName: string,
		key: Record<string, unknown>,
	) => StoreItem | undefined;
	deleteByKey: (tableName: string, key: Record<string, unknown>) => void;
	updateByKey: (
		tableName: string,
		key: Record<string, unknown>,
		updates: Record<string, unknown>,
	) => StoreItem | undefined;
};

// ---------------------------------------------------------------------------
// Table model
// ---------------------------------------------------------------------------

type IndexModel = {
	indexName: string;
	keySchema: KeySchemaDefinition;
};

type TableModel = {
	tableName: string;
	keySchema: KeySchemaDefinition;
	indexes: IndexModel[];
};

type TableState = {
	model: TableModel;
	items: Map<string, AttributeMap>;
	/**
	 * Earlier states of the table, oldest first, ending with the current one.
	 * Only kept when replication lag is simulated.
	 */
	versions: Map<string, AttributeMap>[];
};

/**
 * A read that DynamoDB may answer from a replica that has not caught up:
 * every read of a global secondary index, and a read of the table that does
 * not ask for `ConsistentRead`.
 */
export type EventuallyConsistentRead = {
	operation: "GetItem" | "BatchGetItem" | "Query" | "Scan";
	tableName: string;
	indexName: string | undefined;
};

/**
 * Simulated replication lag. Without it every read sees the latest write, as
 * on DynamoDB Local.
 */
export type ReplicationOptions = {
	/** How many earlier states of a table are kept to be read from. */
	historySize: number;
	/**
	 * How many writes behind the state of one item is, for one eventually
	 * consistent read: 0 is current. Asked once per item and read, so items
	 * can lag independently, as index entries do.
	 */
	resolveItemLag: (read: EventuallyConsistentRead, itemKey: string) => number;
};

/** A write the fake applied, reported after it took effect. */
export type AppliedWrite = {
	tableName: string;
	previous: Record<string, NativeAttributeValue> | undefined;
	next: Record<string, NativeAttributeValue> | undefined;
};

/** The key schema every table generated by the adapter uses. */
const DEFAULT_KEY_SCHEMA: KeySchemaDefinition = {
	partitionKey: { name: "id", type: "S" },
};

const keyAttributeNames = (keySchema: KeySchemaDefinition): string[] => {
	if (keySchema.sortKey === undefined) {
		return [keySchema.partitionKey.name];
	}
	return [keySchema.partitionKey.name, keySchema.sortKey.name];
};

const toKeyAttribute = (
	name: string,
	definitions: AttributeDefinition[],
	owner: string,
): KeyAttributeDefinition => {
	const definition = definitions.find((candidate) => candidate.AttributeName === name);
	const type = definition?.AttributeType;
	if (type !== "S" && type !== "N" && type !== "B") {
		throw unsupported(`key attribute "${name}" of ${owner} without an S, N, or B attribute definition`);
	}
	return { name, type };
};

const toKeySchema = (
	elements: KeySchemaElement[] | undefined,
	definitions: AttributeDefinition[],
	owner: string,
): KeySchemaDefinition => {
	const hash = (elements ?? []).find((element) => element.KeyType === "HASH");
	const range = (elements ?? []).find((element) => element.KeyType === "RANGE");
	if (hash?.AttributeName === undefined) {
		throw unsupported(`${owner} without a HASH key`);
	}
	const partitionKey = toKeyAttribute(hash.AttributeName, definitions, owner);
	if (range?.AttributeName === undefined) {
		return { partitionKey };
	}
	return { partitionKey, sortKey: toKeyAttribute(range.AttributeName, definitions, owner) };
};

const toTableModel = (schema: TableSchema, tableNamePrefix: string): TableModel => {
	const tableName = `${tableNamePrefix}${schema.tableName}`;
	const definitions = schema.tableDefinition.attributeDefinitions;
	const indexes = (schema.tableDefinition.globalSecondaryIndexes ?? []).map((index) => {
		const indexName = index.IndexName ?? "";
		if (index.Projection?.ProjectionType !== "ALL") {
			throw unsupported(`index "${indexName}" of ${tableName} with a projection other than ALL`);
		}
		return {
			indexName,
			keySchema: toKeySchema(index.KeySchema, definitions, `index ${indexName}`),
		};
	});
	return {
		tableName,
		keySchema: toKeySchema(schema.tableDefinition.keySchema, definitions, `table ${tableName}`),
		indexes,
	};
};

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const isEmptyKeyValue = (value: AttributeValue): boolean => {
	if (value.S !== undefined) {
		return value.S.length === 0;
	}
	if (value.B !== undefined) {
		return value.B.length === 0;
	}
	return false;
};

const assertKeyValues = (keySchema: KeySchemaDefinition, item: AttributeMap): void => {
	const definitions = keySchema.sortKey === undefined ? [keySchema.partitionKey] : [keySchema.partitionKey, keySchema.sortKey];
	definitions.forEach((definition) => {
		const value = item[definition.name];
		if (value === undefined) {
			throw validationError("One of the required keys was not given a value");
		}
		if (attributeTypeOf(value) !== definition.type) {
			throw validationError("One or more parameter values were invalid: Type mismatch for key");
		}
		if (isEmptyKeyValue(value)) {
			throw validationError(
				`One or more parameter values are not valid. The AttributeValue for a key attribute cannot contain an empty string value. Key: ${definition.name}`,
			);
		}
	});
};

/**
 * Validate a `Key` parameter: exactly the table's key attributes, with the
 * declared types and non-empty values.
 */
const assertKeyParameter = (model: TableModel, key: AttributeMap): void => {
	const names = keyAttributeNames(model.keySchema);
	if (names.some((name) => key[name] === undefined)) {
		throw validationError("One of the required keys was not given a value");
	}
	if (Object.keys(key).length !== names.length) {
		throw validationError("The number of conditions on the keys is invalid");
	}
	assertKeyValues(model.keySchema, key);
};

/** Secondary-index key attributes, when present, must match the index schema. */
const assertIndexKeyValues = (model: TableModel, item: AttributeMap): void => {
	model.indexes.forEach((index) => {
		const definitions = [index.keySchema.partitionKey, index.keySchema.sortKey].flatMap((definition) =>
			definition === undefined ? [] : [definition],
		);
		definitions.forEach((definition) => {
			const value = item[definition.name];
			if (value === undefined) {
				return;
			}
			const type = attributeTypeOf(value);
			if (type === "NULL") {
				// DynamoDB Local's wording for a NULL secondary-index key value.
				throw validationError("Invalid attribute value type");
			}
			if (type !== definition.type) {
				throw validationError("One or more parameter values were invalid: Type mismatch for Index Key");
			}
			if (isEmptyKeyValue(value)) {
				throw validationError(
					`One or more parameter values are not valid. A value specified for a secondary index key is not supported. The AttributeValue for a key attribute cannot contain an empty string value. IndexName: ${index.indexName}, IndexKey: ${definition.name}`,
				);
			}
		});
	});
};

const assertStorableItem = (model: TableModel, item: AttributeMap): void => {
	assertKeyValues(model.keySchema, item);
	assertIndexKeyValues(model, item);
};

const itemFingerprint = (model: TableModel, item: AttributeMap): string =>
	keyAttributeNames(model.keySchema)
		.map((name) => keyValueFingerprint(item[name]))
		.join("|");

const pickAttributes = (item: AttributeMap, names: string[]): AttributeMap =>
	Object.fromEntries(names.map((name) => [name, item[name]]));

// ---------------------------------------------------------------------------
// Views (the table itself or one of its indexes) and their order
// ---------------------------------------------------------------------------

type View = {
	keySchema: KeySchemaDefinition;
	/** Attributes a LastEvaluatedKey / ExclusiveStartKey of this view holds. */
	positionAttributes: string[];
	positionKeys: KeyAttributeDefinition[];
	indexName: string | undefined;
	items: AttributeMap[];
};

const keyDefinitions = (keySchema: KeySchemaDefinition): KeyAttributeDefinition[] => {
	if (keySchema.sortKey === undefined) {
		return [keySchema.partitionKey];
	}
	return [keySchema.partitionKey, keySchema.sortKey];
};

const compareByAttributes = (names: string[]) => (left: AttributeMap, right: AttributeMap): number => {
	for (const name of names) {
		const order = compareOrderedValues(left[name], right[name]);
		if (order !== undefined && order !== 0) {
			return order;
		}
	}
	return 0;
};

const resolveView = (
	table: TableState,
	indexName: string | undefined,
	items: Map<string, AttributeMap> = table.items,
): View => {
	const tableKeys = keyAttributeNames(table.model.keySchema);
	const allItems = Array.from(items.values());
	if (indexName === undefined) {
		return {
			keySchema: table.model.keySchema,
			positionAttributes: tableKeys,
			positionKeys: keyDefinitions(table.model.keySchema),
			indexName,
			items: allItems.sort(compareByAttributes(tableKeys)),
		};
	}
	const index = table.model.indexes.find((candidate) => candidate.indexName === indexName);
	if (!index) {
		throw validationError(`The table does not have the specified index: ${indexName}`);
	}
	const indexKeys = keyAttributeNames(index.keySchema);
	const positionKeys = [
		...keyDefinitions(index.keySchema),
		...keyDefinitions(table.model.keySchema).filter((definition) => !indexKeys.includes(definition.name)),
	];
	const positionAttributes = positionKeys.map((definition) => definition.name);
	return {
		keySchema: index.keySchema,
		positionAttributes,
		positionKeys,
		indexName,
		items: allItems
			.filter((item) => indexKeys.every((name) => item[name] !== undefined))
			.sort(compareByAttributes(positionAttributes)),
	};
};

// ---------------------------------------------------------------------------
// Request parameter checks
// ---------------------------------------------------------------------------

const assertKnownParameters = (
	operation: string,
	input: object,
	supported: readonly string[],
): void => {
	Object.entries(input).forEach(([name, value]) => {
		if (value === undefined) {
			return;
		}
		if (!supported.includes(name)) {
			throw unsupported(`${operation} parameter "${name}"`);
		}
	});
};

const requireTableName = (tableName: string | undefined): string => {
	if (tableName === undefined || tableName.length === 0) {
		throw validationError("TableName must be specified");
	}
	return tableName;
};

const resolveLimit = (limit: number | undefined): number | undefined => {
	if (limit === undefined) {
		return undefined;
	}
	if (!Number.isInteger(limit) || limit < 1) {
		throw validationError("Limit must be greater than or equal to 1");
	}
	return limit;
};

type ReadSelect = "ALL_ATTRIBUTES" | "COUNT";

const resolveSelect = (select: string | undefined): ReadSelect => {
	if (select === undefined || select === "ALL_ATTRIBUTES") {
		return "ALL_ATTRIBUTES";
	}
	if (select === "COUNT") {
		return "COUNT";
	}
	throw unsupported(`Select "${select}"`);
};

const assertConsistentReadAllowed = (consistentRead: boolean | undefined, indexName: string | undefined): void => {
	if (consistentRead === true && indexName !== undefined) {
		throw validationError("Consistent reads are not supported on global secondary indexes");
	}
};

/**
 * Placeholders are only accepted when the request carries an expression that
 * can use them.
 */
const assertPlaceholdersNeedExpressions = (props: {
	hasExpression: boolean;
	names: unknown;
	values: unknown;
	missingExpressions: string;
}): void => {
	if (props.hasExpression) {
		return;
	}
	if (props.names !== undefined) {
		throw validationError(
			`ExpressionAttributeNames can only be specified when using expressions: ${props.missingExpressions}`,
		);
	}
	if (props.values !== undefined) {
		throw validationError(
			`ExpressionAttributeValues can only be specified when using expressions: ${props.missingExpressions}`,
		);
	}
};

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

type Translator = {
	toAttributeMap: (map: Record<string, unknown>) => AttributeMap;
	toNative: (map: AttributeMap) => Record<string, NativeAttributeValue>;
};

const createTranslator = (translateConfig: TranslateConfig | undefined): Translator => ({
	toAttributeMap: (map) =>
		normalizeAttributeMap(marshall(map, translateConfig?.marshallOptions)),
	toNative: (map) => unmarshall(map, translateConfig?.unmarshallOptions),
});

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

type WriteResult = { Attributes?: Record<string, NativeAttributeValue> | undefined };

/**
 * A keyed write after static validation: the target item, its condition,
 * and the transformation that produces the item to store (`undefined`
 * deletes it).
 */
type WritePlan = {
	table: TableState;
	fingerprint: string;
	condition: Condition | undefined;
	produce: (current: AttributeMap | undefined) => AttributeMap | undefined;
};

const parseOptionalCondition = (
	label: string,
	source: string | undefined,
	context: ExpressionContext,
): Condition | undefined => {
	if (source === undefined) {
		return undefined;
	}
	return parseCondition(label, source, context);
};

const compileConditionContext = (props: {
	conditionExpression: string | undefined;
	names: Record<string, string> | undefined;
	values: AttributeMap | undefined;
	missingExpressions: string;
	extra?: ((context: ExpressionContext) => void) | undefined;
	hasOtherExpression?: boolean | undefined;
}): Condition | undefined => {
	assertPlaceholdersNeedExpressions({
		hasExpression: props.conditionExpression !== undefined || props.hasOtherExpression === true,
		names: props.names,
		values: props.values,
		missingExpressions: props.missingExpressions,
	});
	const context = createExpressionContext({ names: props.names, values: props.values });
	props.extra?.(context);
	const condition = parseOptionalCondition("ConditionExpression", props.conditionExpression, context);
	assertAllPlaceholdersUsed(context);
	return condition;
};

export const createStatefulDocumentClient = (
	options: {
		tableSchemas?: TableSchema[] | undefined;
		tableNamePrefix?: string | undefined;
		replication?: ReplicationOptions | undefined;
		onWrite?: ((write: AppliedWrite) => void) | undefined;
	} = {},
): {
	documentClient: ReturnType<typeof createDocumentClientStub>["documentClient"];
	sendCalls: unknown[];
	store: InMemoryStore;
	/** Forget the earlier states: every replica has caught up with the current one. */
	settleReplication: () => void;
} => {
	const tables = new Map<string, TableState>();
	(options.tableSchemas ?? []).forEach((schema) => {
		const model = toTableModel(schema, options.tableNamePrefix ?? "");
		tables.set(model.tableName, { model, items: new Map(), versions: [new Map()] });
	});
	const replication = options.replication;

	// A write (or a whole transaction) becomes one new version of each table
	// it touched: a lagging read never sees half of a transaction's writes to
	// one table.
	const recordVersion = (table: TableState): void => {
		if (!replication) {
			return;
		}
		table.versions.push(new Map(table.items));
		if (table.versions.length > replication.historySize + 1) {
			table.versions.shift();
		}
	};

	/**
	 * The items a read sees. A consistent read sees the current state. An
	 * eventually consistent one sees, for every item, the state it had some
	 * writes ago (possibly not yet existing, or still existing).
	 */
	const readItems = (
		table: TableState,
		read: { operation: EventuallyConsistentRead["operation"]; indexName: string | undefined; consistent: boolean },
	): Map<string, AttributeMap> => {
		if (!replication || read.consistent) {
			return table.items;
		}
		const newest = table.versions.length - 1;
		const itemKeys = new Set(table.versions.flatMap((version) => Array.from(version.keys())));
		const seen = new Map<string, AttributeMap>();
		itemKeys.forEach((itemKey) => {
			const lag = replication.resolveItemLag(
				{ operation: read.operation, tableName: table.model.tableName, indexName: read.indexName },
				itemKey,
			);
			const version = table.versions[Math.max(0, newest - Math.max(0, Math.floor(lag)))];
			const item = version.get(itemKey);
			if (item !== undefined) {
				seen.set(itemKey, item);
			}
		});
		return seen;
	};

	const resolveTable = (tableName: string): TableState => {
		const existing = tables.get(tableName);
		if (existing) {
			return existing;
		}
		const created: TableState = {
			model: { tableName, keySchema: DEFAULT_KEY_SCHEMA, indexes: [] },
			items: new Map(),
			versions: [new Map()],
		};
		tables.set(tableName, created);
		return created;
	};

	// The stub document client is created with this translate config, and the
	// fake marshals / unmarshals with it, exactly as a real document client
	// would. `removeUndefinedValues` is the configuration the README requires
	// and the DynamoDB Local specs use (`createTestClients`).
	const translateConfig: TranslateConfig = {
		marshallOptions: { removeUndefinedValues: true },
	};
	const translator = createTranslator(translateConfig);
	const toAttributeMap = translator.toAttributeMap;
	const toNative = translator.toNative;
	const toOptionalAttributeMap = (map: Record<string, unknown> | undefined): AttributeMap | undefined =>
		map === undefined ? undefined : toAttributeMap(map);

	const toKey = (table: TableState, key: Record<string, unknown> | undefined): AttributeMap => {
		const attributes = toAttributeMap(key ?? {});
		assertKeyParameter(table.model, attributes);
		return attributes;
	};

	// --- writes -------------------------------------------------------------

	const planPut = (input: {
		TableName?: string | undefined;
		Item?: Record<string, unknown> | undefined;
		ConditionExpression?: string | undefined;
		ExpressionAttributeNames?: Record<string, string> | undefined;
		ExpressionAttributeValues?: Record<string, unknown> | undefined;
	}): WritePlan => {
		const table = resolveTable(requireTableName(input.TableName));
		if (input.Item === undefined) {
			throw validationError("1 validation error detected: Value null at 'item' failed to satisfy constraint: Member must not be null");
		}
		const item = toAttributeMap(input.Item);
		assertStorableItem(table.model, item);
		const condition = compileConditionContext({
			conditionExpression: input.ConditionExpression,
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
			missingExpressions: "ConditionExpression is null",
		});
		return {
			table,
			fingerprint: itemFingerprint(table.model, item),
			condition,
			produce: () => cloneAttributeMap(item),
		};
	};

	const planDelete = (input: {
		TableName?: string | undefined;
		Key?: Record<string, unknown> | undefined;
		ConditionExpression?: string | undefined;
		ExpressionAttributeNames?: Record<string, string> | undefined;
		ExpressionAttributeValues?: Record<string, unknown> | undefined;
	}): WritePlan => {
		const table = resolveTable(requireTableName(input.TableName));
		const key = toKey(table, input.Key);
		const condition = compileConditionContext({
			conditionExpression: input.ConditionExpression,
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
			missingExpressions: "ConditionExpression is null",
		});
		return {
			table,
			fingerprint: itemFingerprint(table.model, key),
			condition,
			produce: () => undefined,
		};
	};

	const planUpdate = (input: {
		TableName?: string | undefined;
		Key?: Record<string, unknown> | undefined;
		UpdateExpression?: string | undefined;
		ConditionExpression?: string | undefined;
		ExpressionAttributeNames?: Record<string, string> | undefined;
		ExpressionAttributeValues?: Record<string, unknown> | undefined;
	}): WritePlan => {
		const table = resolveTable(requireTableName(input.TableName));
		const key = toKey(table, input.Key);
		const compiled: { update: CompiledUpdate } = { update: { actions: [] } };
		const condition = compileConditionContext({
			conditionExpression: input.ConditionExpression,
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
			missingExpressions: "UpdateExpression and ConditionExpression are null",
			hasOtherExpression: input.UpdateExpression !== undefined,
			extra: (context) => {
				if (input.UpdateExpression !== undefined) {
					compiled.update = parseUpdate(input.UpdateExpression, context);
				}
			},
		});
		const keyNames = keyAttributeNames(table.model.keySchema);
		const keyUpdate = updatedTopLevelNames(compiled.update).find((name) => keyNames.includes(name));
		if (keyUpdate !== undefined) {
			throw validationError(
				`One or more parameter values were invalid: Cannot update attribute ${keyUpdate}. This attribute is part of the key`,
			);
		}
		return {
			table,
			fingerprint: itemFingerprint(table.model, key),
			condition,
			produce: (current) => {
				const next = applyUpdate(compiled.update, current ?? key);
				assertStorableItem(table.model, next);
				return next;
			},
		};
	};

	const planConditionCheck = (input: {
		TableName?: string | undefined;
		Key?: Record<string, unknown> | undefined;
		ConditionExpression?: string | undefined;
		ExpressionAttributeNames?: Record<string, string> | undefined;
		ExpressionAttributeValues?: Record<string, unknown> | undefined;
	}): WritePlan => {
		const table = resolveTable(requireTableName(input.TableName));
		const key = toKey(table, input.Key);
		if (input.ConditionExpression === undefined) {
			throw validationError("ConditionExpression must be specified for a ConditionCheck");
		}
		const condition = compileConditionContext({
			conditionExpression: input.ConditionExpression,
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
			missingExpressions: "ConditionExpression is null",
		});
		return {
			table,
			fingerprint: itemFingerprint(table.model, key),
			condition,
			produce: (current) => current,
		};
	};

	const conditionHolds = (plan: WritePlan): boolean => {
		if (plan.condition === undefined) {
			return true;
		}
		return evaluateCondition(plan.condition, plan.table.items.get(plan.fingerprint) ?? {});
	};

	const cancellationReasonFor = (plan: WritePlan): CancellationReason => {
		if (conditionHolds(plan)) {
			return { Code: "None" };
		}
		return { Code: "ConditionalCheckFailed", Message: "The conditional request failed" };
	};

	const toOptionalNative = (item: AttributeMap | undefined) => (item === undefined ? undefined : toNative(item));

	const commit = (plan: WritePlan, next: AttributeMap | undefined): void => {
		const previous = plan.table.items.get(plan.fingerprint);
		if (next === undefined) {
			plan.table.items.delete(plan.fingerprint);
		} else {
			plan.table.items.set(plan.fingerprint, next);
		}
		if (previous === undefined && next === undefined) {
			return;
		}
		options.onWrite?.({
			tableName: plan.table.model.tableName,
			previous: toOptionalNative(previous),
			next: toOptionalNative(next),
		});
	};

	/** Run a single keyed write and return the (old, new) item pair. */
	const executeWrite = (plan: WritePlan): { previous: AttributeMap | undefined; next: AttributeMap | undefined } => {
		if (!conditionHolds(plan)) {
			throw conditionalCheckFailed();
		}
		const previous = plan.table.items.get(plan.fingerprint);
		const next = plan.produce(previous);
		commit(plan, next);
		recordVersion(plan.table);
		return { previous, next };
	};

	const returnAttributes = (item: AttributeMap | undefined): WriteResult =>
		item === undefined ? {} : { Attributes: toNative(item) };

	/**
	 * `allowed` are the values the operation accepts and the fake emulates;
	 * `valid` are values DynamoDB accepts that the fake does not emulate.
	 */
	const resolveReturnValues = (
		returnValues: string | undefined,
		allowed: readonly string[],
		valid: readonly string[] = [],
	): string => {
		const value = returnValues ?? "NONE";
		if (valid.includes(value)) {
			throw unsupported(`ReturnValues "${value}"`);
		}
		if (!allowed.includes(value)) {
			throw validationError("Return values set to invalid value");
		}
		return value;
	};

	const WRITE_PARAMETERS = [
		"TableName",
		"ConditionExpression",
		"ExpressionAttributeNames",
		"ExpressionAttributeValues",
	] as const;

	const handlePut = (command: PutCommand): WriteResult => {
		assertKnownParameters("PutItem", command.input, [...WRITE_PARAMETERS, "Item", "ReturnValues"]);
		const returnValues = resolveReturnValues(command.input.ReturnValues, ["NONE", "ALL_OLD"]);
		const { previous } = executeWrite(planPut(command.input));
		return returnValues === "ALL_OLD" ? returnAttributes(previous) : {};
	};

	const handleDelete = (command: DeleteCommand): WriteResult => {
		assertKnownParameters("DeleteItem", command.input, [...WRITE_PARAMETERS, "Key", "ReturnValues"]);
		const returnValues = resolveReturnValues(command.input.ReturnValues, ["NONE", "ALL_OLD"]);
		const { previous } = executeWrite(planDelete(command.input));
		return returnValues === "ALL_OLD" ? returnAttributes(previous) : {};
	};

	const handleUpdate = (command: UpdateCommand): WriteResult => {
		assertKnownParameters("UpdateItem", command.input, [
			...WRITE_PARAMETERS,
			"Key",
			"UpdateExpression",
			"ReturnValues",
		]);
		const returnValues = resolveReturnValues(
			command.input.ReturnValues,
			["NONE", "ALL_OLD", "ALL_NEW"],
			["UPDATED_OLD", "UPDATED_NEW"],
		);
		const { previous, next } = executeWrite(planUpdate(command.input));
		if (returnValues === "ALL_OLD") {
			return returnAttributes(previous);
		}
		return returnValues === "ALL_NEW" ? returnAttributes(next) : {};
	};

	const TRANSACT_ITEM_KINDS = ["Put", "Update", "Delete", "ConditionCheck"] as const;

	const planTransactItem = (command: TransactItem): WritePlan => {
		const kinds = TRANSACT_ITEM_KINDS.filter((kind) => command[kind] !== undefined);
		assertKnownParameters("TransactWriteItems item", command, TRANSACT_ITEM_KINDS);
		if (kinds.length !== 1) {
			throw validationError("TransactItems can only contain one of Check, Put, Update or Delete");
		}
		if (command.Put) {
			assertKnownParameters("TransactWriteItems Put", command.Put, [...WRITE_PARAMETERS, "Item"]);
			return planPut(command.Put);
		}
		if (command.Update) {
			assertKnownParameters("TransactWriteItems Update", command.Update, [
				...WRITE_PARAMETERS,
				"Key",
				"UpdateExpression",
			]);
			return planUpdate(command.Update);
		}
		if (command.Delete) {
			assertKnownParameters("TransactWriteItems Delete", command.Delete, [...WRITE_PARAMETERS, "Key"]);
			return planDelete(command.Delete);
		}
		if (command.ConditionCheck) {
			assertKnownParameters("TransactWriteItems ConditionCheck", command.ConditionCheck, [
				...WRITE_PARAMETERS,
				"Key",
			]);
			return planConditionCheck(command.ConditionCheck);
		}
		throw validationError("TransactItems can only contain one of Check, Put, Update or Delete");
	};

	const handleTransactWrite = (command: TransactWriteCommand): Record<string, never> => {
		assertKnownParameters("TransactWriteItems", command.input, ["TransactItems"]);
		const entries = command.input.TransactItems ?? [];
		if (entries.length < 1 || entries.length > 100) {
			throw validationError(
				`Value [] at 'transactItems' failed to satisfy constraint: Member must have length between 1 and 100`,
			);
		}
		const plans = entries.map(planTransactItem);
		const targets = new Set<string>();
		plans.forEach((plan) => {
			const target = `${plan.table.model.tableName}\u0000${plan.fingerprint}`;
			if (targets.has(target)) {
				throw validationError("Transaction request cannot include multiple operations on one item");
			}
			targets.add(target);
		});
		const reasons: CancellationReason[] = plans.map(cancellationReasonFor);
		if (reasons.some((reason) => reason.Code !== "None")) {
			throw transactionCanceled(reasons);
		}
		// Compute every new item before storing any: a runtime error in one
		// operation leaves the whole table unchanged (DynamoDB Local answers it
		// with a ValidationException, not a cancellation).
		const results = plans.map((plan) => plan.produce(plan.table.items.get(plan.fingerprint)));
		plans.forEach((plan, index) => commit(plan, results[index]));
		new Set(plans.map((plan) => plan.table)).forEach(recordVersion);
		return {};
	};

	// --- reads --------------------------------------------------------------

	const handleGet = (command: GetCommand): { Item?: Record<string, NativeAttributeValue> | undefined } => {
		assertKnownParameters("GetItem", command.input, ["TableName", "Key", "ConsistentRead"]);
		const table = resolveTable(requireTableName(command.input.TableName));
		const key = toKey(table, command.input.Key);
		const item = readItems(table, {
			operation: "GetItem",
			indexName: undefined,
			consistent: command.input.ConsistentRead === true,
		}).get(itemFingerprint(table.model, key));
		return item === undefined ? {} : { Item: toNative(item) };
	};

	const handleBatchGet = (command: BatchGetCommand) => {
		assertKnownParameters("BatchGetItem", command.input, ["RequestItems"]);
		const requestItems = command.input.RequestItems ?? {};
		const requests = Object.entries(requestItems).map(([tableName, request]) => {
			assertKnownParameters("BatchGetItem RequestItems", request, ["Keys", "ConsistentRead"]);
			const table = resolveTable(tableName);
			const keys = (request.Keys ?? []).map((key) => toKey(table, key));
			if (keys.length === 0) {
				throw validationError(
					`The list of keys in RequestItems for BatchGetItem is required: ${tableName} has empty list`,
				);
			}
			const fingerprints = keys.map((key) => itemFingerprint(table.model, key));
			if (new Set(fingerprints).size !== fingerprints.length) {
				throw validationError("Provided list of item keys contains duplicates");
			}
			const items = readItems(table, {
				operation: "BatchGetItem",
				indexName: undefined,
				consistent: request.ConsistentRead === true,
			});
			return { tableName, table, fingerprints, items };
		});
		if (requests.length === 0) {
			throw validationError("The requestItems parameter is required for BatchGetItem");
		}
		const keyCount = requests.reduce((total, request) => total + request.fingerprints.length, 0);
		if (keyCount > 100) {
			throw validationError("Too many items requested for the BatchGetItem call");
		}
		const responses = Object.fromEntries(
			requests.map((request) => [
				request.tableName,
				request.fingerprints.flatMap((fingerprint) => {
					const item = request.items.get(fingerprint);
					return item === undefined ? [] : [toNative(item)];
				}),
			]),
		);
		return { Responses: responses, UnprocessedKeys: {} };
	};

	/**
	 * Validate an ExclusiveStartKey: exactly the view's position attributes,
	 * with their key types, and — for a Query — inside the key condition.
	 */
	const toStartPosition = (
		view: View,
		exclusiveStartKey: Record<string, unknown>,
		keyCondition: Condition | undefined,
	): AttributeMap => {
		const start = toAttributeMap(exclusiveStartKey);
		const missing = view.positionAttributes.some((name) => start[name] === undefined);
		if (missing || Object.keys(start).length !== view.positionAttributes.length) {
			throw validationError("The provided starting key is invalid");
		}
		view.positionKeys.forEach((definition) => {
			if (attributeTypeOf(start[definition.name]) !== definition.type) {
				throw validationError("Type mismatch for attribute to update");
			}
		});
		if (keyCondition !== undefined && !evaluateCondition(keyCondition, start)) {
			throw validationError("The provided starting key does not match the range key predicate");
		}
		return start;
	};

	const resumeAfter = (
		view: View,
		ordered: AttributeMap[],
		forward: boolean,
		exclusiveStartKey: Record<string, unknown> | undefined,
		keyCondition: Condition | undefined,
	): AttributeMap[] => {
		if (exclusiveStartKey === undefined) {
			return ordered;
		}
		const start = toStartPosition(view, exclusiveStartKey, keyCondition);
		const compare = compareByAttributes(view.positionAttributes);
		const position = ordered.findIndex((item) =>
			forward ? compare(item, start) > 0 : compare(item, start) < 0,
		);
		return position < 0 ? [] : ordered.slice(position);
	};

	type ReadOutput = {
		Items?: Record<string, NativeAttributeValue>[] | undefined;
		Count: number;
		ScannedCount: number;
		LastEvaluatedKey?: Record<string, NativeAttributeValue> | undefined;
	};

	const readPage = (props: {
		view: View;
		candidates: AttributeMap[];
		forward: boolean;
		exclusiveStartKey: Record<string, unknown> | undefined;
		limit: number | undefined;
		filter: Condition | undefined;
		select: ReadSelect;
		/** The read covers one item at most and never returns a LastEvaluatedKey. */
		uniqueItem: boolean;
		keyCondition: Condition | undefined;
	}): ReadOutput => {
		const ordered = props.forward ? props.candidates : [...props.candidates].reverse();
		const remaining = resumeAfter(props.view, ordered, props.forward, props.exclusiveStartKey, props.keyCondition);
		const evaluated = props.limit === undefined ? remaining : remaining.slice(0, props.limit);
		const filter = props.filter;
		const matched = filter === undefined ? evaluated : evaluated.filter((item) => evaluateCondition(filter, item));
		const last = evaluated[evaluated.length - 1];
		const stoppedByLimit = !props.uniqueItem && props.limit !== undefined && evaluated.length === props.limit;
		const output: ReadOutput = {
			Count: matched.length,
			ScannedCount: evaluated.length,
		};
		if (props.select === "ALL_ATTRIBUTES") {
			output.Items = matched.map(toNative);
		}
		if (stoppedByLimit && last !== undefined) {
			output.LastEvaluatedKey = toNative(pickAttributes(last, props.view.positionAttributes));
		}
		return output;
	};

	const assertFilterAvoidsKeys = (filter: Condition, keySchema: KeySchemaDefinition): void => {
		// DynamoDB rejects a Query filter on the key attributes of the queried
		// table or index (they belong in the KeyConditionExpression). The fake
		// knows those attributes from the declared table schema; for an implicit
		// table that is the default `id` partition key.
		const keyNames = keyAttributeNames(keySchema);
		conditionPaths(filter).forEach((path) => {
			const head = path[0];
			if (head.kind !== "attribute" || !keyNames.includes(head.name)) {
				return;
			}
			if (path.length > 1) {
				throw validationError(
					`Key attributes must be scalars; list random access '[]' and map lookup '.' are not allowed: Key: ${head.name}`,
				);
			}
			throw validationError(
				`Filter Expression can only contain non-primary key attributes: Primary key attribute: ${head.name}`,
			);
		});
	};

	const handleQuery = (command: QueryCommand): ReadOutput => {
		const input = command.input;
		assertKnownParameters("Query", input, [
			"TableName",
			"IndexName",
			"KeyConditionExpression",
			"FilterExpression",
			"ExpressionAttributeNames",
			"ExpressionAttributeValues",
			"Limit",
			"ExclusiveStartKey",
			"ScanIndexForward",
			"Select",
			"ConsistentRead",
		]);
		const table = resolveTable(requireTableName(input.TableName));
		if (input.KeyConditionExpression === undefined) {
			throw validationError(
				"Either the KeyConditions or KeyConditionExpression parameter must be specified in the request.",
			);
		}
		const limit = resolveLimit(input.Limit);
		const select = resolveSelect(input.Select);
		assertConsistentReadAllowed(input.ConsistentRead, input.IndexName);
		const context = createExpressionContext({
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
		});
		const keyCondition = parseCondition("KeyConditionExpression", input.KeyConditionExpression, context);
		const filter = parseOptionalCondition("FilterExpression", input.FilterExpression, context);
		assertAllPlaceholdersUsed(context);
		const view = resolveView(
			table,
			input.IndexName,
			readItems(table, {
				operation: "Query",
				indexName: input.IndexName,
				consistent: input.ConsistentRead === true,
			}),
		);
		assertValidKeyCondition(keyCondition, view.keySchema);
		if (filter !== undefined) {
			assertFilterAvoidsKeys(filter, view.keySchema);
		}
		// A query on a table without a sort key reads one partition that holds
		// one item at most; DynamoDB Local returns no LastEvaluatedKey for it
		// even when Limit is reached (it does for a composite key, and for
		// every index query).
		const singleItemPartition = input.IndexName === undefined && view.keySchema.sortKey === undefined;
		return readPage({
			view,
			candidates: view.items.filter((item) => evaluateCondition(keyCondition, item)),
			forward: input.ScanIndexForward !== false,
			exclusiveStartKey: input.ExclusiveStartKey,
			limit,
			filter,
			select,
			uniqueItem: singleItemPartition,
			keyCondition,
		});
	};

	const handleScan = (command: ScanCommand): ReadOutput => {
		const input = command.input;
		assertKnownParameters("Scan", input, [
			"TableName",
			"IndexName",
			"FilterExpression",
			"ExpressionAttributeNames",
			"ExpressionAttributeValues",
			"Limit",
			"ExclusiveStartKey",
			"Select",
			"ConsistentRead",
		]);
		const table = resolveTable(requireTableName(input.TableName));
		const limit = resolveLimit(input.Limit);
		const select = resolveSelect(input.Select);
		assertConsistentReadAllowed(input.ConsistentRead, input.IndexName);
		assertPlaceholdersNeedExpressions({
			hasExpression: input.FilterExpression !== undefined,
			names: input.ExpressionAttributeNames,
			values: input.ExpressionAttributeValues,
			missingExpressions: "FilterExpression is null",
		});
		const context = createExpressionContext({
			names: input.ExpressionAttributeNames,
			values: toOptionalAttributeMap(input.ExpressionAttributeValues),
		});
		const filter = parseOptionalCondition("FilterExpression", input.FilterExpression, context);
		assertAllPlaceholdersUsed(context);
		const view = resolveView(
			table,
			input.IndexName,
			readItems(table, {
				operation: "Scan",
				indexName: input.IndexName,
				consistent: input.ConsistentRead === true,
			}),
		);
		return readPage({
			view,
			candidates: view.items,
			forward: true,
			exclusiveStartKey: input.ExclusiveStartKey,
			limit,
			filter,
			select,
			uniqueItem: false,
			keyCondition: undefined,
		});
	};

	const describeCommand = (command: unknown): string => {
		if (typeof command === "object" && command !== null) {
			return command.constructor.name;
		}
		return typeof command;
	};

	const { documentClient, sendCalls } = createDocumentClientStub({
		translateConfig,
		respond: async (command) => {
			if (command instanceof GetCommand) {
				return handleGet(command);
			}
			if (command instanceof PutCommand) {
				return handlePut(command);
			}
			if (command instanceof UpdateCommand) {
				return handleUpdate(command);
			}
			if (command instanceof DeleteCommand) {
				return handleDelete(command);
			}
			if (command instanceof QueryCommand) {
				return handleQuery(command);
			}
			if (command instanceof ScanCommand) {
				return handleScan(command);
			}
			if (command instanceof BatchGetCommand) {
				return handleBatchGet(command);
			}
			if (command instanceof TransactWriteCommand) {
				return handleTransactWrite(command);
			}
			throw unsupported(`command ${describeCommand(command)}`);
		},
	});

	// --- direct store access for assertions and setup ---------------------

	const listItems = (tableName: string): StoreItem[] => {
		const table = tables.get(tableName);
		if (!table) {
			return [];
		}
		return resolveView(table, undefined).items.map(toNative);
	};

	const store: InMemoryStore = {
		put: (tableName, item) => {
			const table = resolveTable(tableName);
			const attributes = toAttributeMap(item);
			assertStorableItem(table.model, attributes);
			table.items.set(itemFingerprint(table.model, attributes), attributes);
			recordVersion(table);
		},
		get: listItems,
		findByKey: (tableName, key) => {
			const table = tables.get(tableName);
			if (!table) {
				return undefined;
			}
			const item = table.items.get(itemFingerprint(table.model, toKey(table, key)));
			return item === undefined ? undefined : toNative(item);
		},
		deleteByKey: (tableName, key) => {
			const table = tables.get(tableName);
			if (!table) {
				return;
			}
			table.items.delete(itemFingerprint(table.model, toKey(table, key)));
			recordVersion(table);
		},
		updateByKey: (tableName, key, updates) => {
			const table = tables.get(tableName);
			if (!table) {
				return undefined;
			}
			const fingerprint = itemFingerprint(table.model, toKey(table, key));
			const current = table.items.get(fingerprint);
			if (current === undefined) {
				return undefined;
			}
			const next = toAttributeMap({ ...toNative(current), ...updates });
			assertStorableItem(table.model, next);
			if (itemFingerprint(table.model, next) !== fingerprint) {
				throw unsupported("store.updateByKey changing key attributes");
			}
			table.items.set(fingerprint, next);
			recordVersion(table);
			return toNative(next);
		},
	};

	const settleReplication = (): void => {
		tables.forEach((table) => {
			table.versions = [new Map(table.items)];
		});
	};

	return { documentClient, sendCalls, store, settleReplication };
};
