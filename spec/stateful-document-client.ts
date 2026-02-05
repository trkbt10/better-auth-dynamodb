/**
 * @file Stateful DynamoDB document client stub for integration tests.
 *
 * Maintains an in-memory store so that writes (PutCommand, UpdateCommand,
 * DeleteCommand) are visible to subsequent reads (BatchGetCommand,
 * ScanCommand, QueryCommand). Also processes TransactWriteCommand items.
 */
import {
	BatchGetCommand,
	DeleteCommand,
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
	UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "./dynamodb-document-client";

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

const createInMemoryStore = (): InMemoryStore => {
	const tables = new Map<string, StoreItem[]>();

	const getItems = (tableName: string): StoreItem[] =>
		tables.get(tableName) ?? [];

	const matchesKey = (
		item: StoreItem,
		key: Record<string, unknown>,
	): boolean =>
		Object.entries(key).every(([k, v]) => item[k] === v);

	return {
		put: (tableName, item) => {
			const items = tables.get(tableName);
			if (items) {
				const existingIndex = items.findIndex((existing) =>
					existing.id !== undefined && existing.id === item.id,
				);
				if (existingIndex >= 0) {
					items[existingIndex] = { ...item };
				} else {
					items.push({ ...item });
				}
			} else {
				tables.set(tableName, [{ ...item }]);
			}
		},
		get: getItems,
		findByKey: (tableName, key) =>
			getItems(tableName).find((item) => matchesKey(item, key)),
		deleteByKey: (tableName, key) => {
			const items = getItems(tableName);
			const filtered = items.filter((item) => !matchesKey(item, key));
			tables.set(tableName, filtered);
		},
		updateByKey: (tableName, key, updates) => {
			const items = getItems(tableName);
			const target = items.find((item) => matchesKey(item, key));
			if (!target) {
				return undefined;
			}
			Object.assign(target, updates);
			return { ...target };
		},
	};
};

/**
 * Parse a DynamoDB SET update expression and resolve field-value pairs.
 *
 * Handles expressions like: `SET #a0 = :v0, #a1 = :v1`
 */
const parseSetUpdates = (
	updateExpression: string | undefined,
	attributeNames: Record<string, string> | undefined,
	attributeValues: Record<string, unknown> | undefined,
): Record<string, unknown> => {
	if (!updateExpression) {
		return {};
	}
	const names = attributeNames ?? {};
	const values = attributeValues ?? {};
	const result: Record<string, unknown> = {};

	const setMatch = updateExpression.match(/SET\s+(.+?)(?:\s+(?:ADD|REMOVE|DELETE)\s|$)/i);
	if (!setMatch) {
		return result;
	}

	const assignments = setMatch[1].split(",");
	for (const assignment of assignments) {
		const parts = assignment.trim().match(/^(#\w+)\s*=\s*(:[\w]+)$/);
		if (!parts) {
			continue;
		}
		const nameKey = parts[1];
		const valueKey = parts[2];
		const fieldName = names[nameKey];
		if (fieldName && valueKey in values) {
			result[fieldName] = values[valueKey];
		}
	}

	return result;
};

/**
 * Extract equality conditions from a FilterExpression or KeyConditionExpression.
 *
 * Supports `#name = :value` patterns joined by ` AND `.
 * Resolves attribute names and values, returning field-value pairs.
 */
const resolveExpressionFilter = (
	expression: string | undefined,
	attributeNames: Record<string, string> | undefined,
	attributeValues: Record<string, unknown> | undefined,
): Record<string, unknown> => {
	if (!expression) {
		return {};
	}
	const names = attributeNames ?? {};
	const values = attributeValues ?? {};
	const result: Record<string, unknown> = {};

	const clauses = expression.split(/\s+AND\s+/i);
	for (const clause of clauses) {
		const eqMatch = clause.trim().match(/^(#\w+)\s*=\s*(:[\w]+)$/);
		if (!eqMatch) {
			continue;
		}
		const fieldName = names[eqMatch[1]];
		const value = values[eqMatch[2]];
		if (fieldName !== undefined && value !== undefined) {
			result[fieldName] = value;
		}
	}

	return result;
};

const applyExpressionFilter = (
	items: StoreItem[],
	filterExpression: string | undefined,
	attributeNames: Record<string, string> | undefined,
	attributeValues: Record<string, unknown> | undefined,
): StoreItem[] => {
	const conditions = resolveExpressionFilter(
		filterExpression,
		attributeNames,
		attributeValues,
	);
	if (Object.keys(conditions).length === 0) {
		return items;
	}
	return items.filter((item) =>
		Object.entries(conditions).every(([k, v]) => item[k] === v),
	);
};

const processTransactWriteItems = (
	store: InMemoryStore,
	transactItems: Array<Record<string, unknown>> | undefined,
): void => {
	if (!transactItems) {
		return;
	}
	for (const item of transactItems) {
		const put = item.Put as
			| { TableName?: string; Item?: StoreItem }
			| undefined;
		if (put?.TableName && put.Item) {
			store.put(put.TableName, put.Item);
			continue;
		}

		const update = item.Update as
			| {
					TableName?: string;
					Key?: Record<string, unknown>;
					UpdateExpression?: string;
					ExpressionAttributeNames?: Record<string, string>;
					ExpressionAttributeValues?: Record<string, unknown>;
			  }
			| undefined;
		if (update?.TableName && update.Key) {
			const updates = parseSetUpdates(
				update.UpdateExpression,
				update.ExpressionAttributeNames,
				update.ExpressionAttributeValues,
			);
			store.updateByKey(update.TableName, update.Key, updates);
			continue;
		}

		const del = item.Delete as
			| { TableName?: string; Key?: Record<string, unknown> }
			| undefined;
		if (del?.TableName && del.Key) {
			store.deleteByKey(del.TableName, del.Key);
		}
	}
};

export const createStatefulDocumentClient = (): {
	documentClient: ReturnType<typeof createDocumentClientStub>["documentClient"];
	sendCalls: unknown[];
	store: InMemoryStore;
} => {
	const store = createInMemoryStore();

	const { documentClient, sendCalls } = createDocumentClientStub({
		respond: async (command) => {
			if (command instanceof PutCommand) {
				const tableName = command.input.TableName ?? "";
				const item = command.input.Item ?? {};
				store.put(tableName, item as StoreItem);
				return {};
			}

			if (command instanceof UpdateCommand) {
				const tableName = command.input.TableName ?? "";
				const key = (command.input.Key ?? {}) as Record<string, unknown>;
				const updates = parseSetUpdates(
					command.input.UpdateExpression,
					command.input.ExpressionAttributeNames,
					command.input.ExpressionAttributeValues as
						| Record<string, unknown>
						| undefined,
				);
				const updated = store.updateByKey(tableName, key, updates);
				if (command.input.ReturnValues === "ALL_NEW" && updated) {
					return { Attributes: updated };
				}
				return {};
			}

			if (command instanceof DeleteCommand) {
				const tableName = command.input.TableName ?? "";
				const key = (command.input.Key ?? {}) as Record<string, unknown>;
				store.deleteByKey(tableName, key);
				return {};
			}

			if (command instanceof BatchGetCommand) {
				const requestItems = command.input.RequestItems ?? {};
				const responses: Record<string, StoreItem[]> = {};
				for (const [tableName, request] of Object.entries(requestItems)) {
					const keys = (request.Keys ?? []) as Record<string, unknown>[];
					const items = store.get(tableName);
					responses[tableName] = items.filter((item) =>
						keys.some((key) =>
							Object.entries(key).every(
								([k, v]) => item[k] === v,
							),
						),
					);
				}
				return { Responses: responses };
			}

			if (command instanceof ScanCommand) {
				const tableName = command.input.TableName ?? "";
				const items = applyExpressionFilter(
					store.get(tableName),
					command.input.FilterExpression,
					command.input.ExpressionAttributeNames,
					command.input.ExpressionAttributeValues as
						| Record<string, unknown>
						| undefined,
				);
				return {
					Items: items,
					LastEvaluatedKey: undefined,
				};
			}

			if (command instanceof QueryCommand) {
				const tableName = command.input.TableName ?? "";
				const allNames = {
					...command.input.ExpressionAttributeNames,
				};
				const allValues = {
					...(command.input.ExpressionAttributeValues as
						| Record<string, unknown>
						| undefined),
				};
				// Merge both KeyConditionExpression and FilterExpression
				const expressions = [
					command.input.KeyConditionExpression,
					command.input.FilterExpression,
				]
					.filter((e): e is string => typeof e === "string")
					.join(" AND ");
				const items = applyExpressionFilter(
					store.get(tableName),
					expressions.length > 0 ? expressions : undefined,
					allNames,
					allValues,
				);
				return {
					Items: items,
					LastEvaluatedKey: undefined,
				};
			}

			if (command instanceof TransactWriteCommand) {
				processTransactWriteItems(
					store,
					command.input.TransactItems as
						| Array<Record<string, unknown>>
						| undefined,
				);
				return {};
			}

			return {};
		},
	});

	return { documentClient, sendCalls, store };
};
