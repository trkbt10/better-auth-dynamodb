/**
 * @file Tests for DynamoDB transaction helpers.
 */
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import {
	TRANSACTION_ITEM_LIMIT,
	applyTransactionOverlay,
	bufferTransactionCreate,
	bufferTransactionWrite,
	createTransactionState,
	executeTransaction,
	findTransactionItem,
	hasTransactionItems,
	pinTransactionFields,
	type DynamoDBTransactionState,
} from "./transaction";
import { DynamoDBAdapterError } from "../errors/errors";

describe("transaction helpers", () => {
	const captureError = (fn: () => void): unknown => {
		try {
			fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	const commit = async (state: DynamoDBTransactionState): Promise<unknown[]> => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		await executeTransaction({ documentClient, state });
		return sendCalls;
	};

	const committedItems = async (
		state: DynamoDBTransactionState,
	): Promise<unknown> => {
		const [command] = await commit(state);
		if (!(command instanceof TransactWriteCommand)) {
			throw new Error("Expected a TransactWriteCommand to be sent.");
		}
		return command.input.TransactItems;
	};

	test("enforces the transaction item limit", () => {
		const state = createTransactionState();
		for (let index = 0; index < TRANSACTION_ITEM_LIMIT; index += 1) {
			bufferTransactionCreate(state, {
				tableName: "users",
				keyField: "id",
				item: { id: `user-${index}` },
			});
		}

		const error = captureError(() =>
			bufferTransactionCreate(state, {
				tableName: "users",
				keyField: "id",
				item: { id: "overflow" },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("TRANSACTION_LIMIT");
		}
	});

	test("sends nothing for an empty transaction", async () => {
		expect(await commit(createTransactionState())).toEqual([]);
	});

	test("creates a row only when its key is free", async () => {
		const state = createTransactionState();
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "user-1", name: "a" },
		});

		expect(await committedItems(state)).toEqual([
			{
				Put: {
					TableName: "users",
					Item: { id: "user-1", name: "a" },
					ConditionExpression: "attribute_not_exists(#pk)",
					ExpressionAttributeNames: { "#pk": "id" },
				},
			},
		]);
	});

	test("rejects a second create of a row the transaction holds", () => {
		const state = createTransactionState();
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "user-1" },
		});

		const error = captureError(() =>
			bufferTransactionCreate(state, {
				tableName: "users",
				keyField: "id",
				item: { id: "user-1" },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("DUPLICATE_PRIMARY_KEY");
		}
	});

	test("rejects a create without the primary key", () => {
		const error = captureError(() =>
			bufferTransactionCreate(createTransactionState(), {
				tableName: "users",
				keyField: "id",
				item: { name: "a" },
			}),
		);

		expect(error).toBeInstanceOf(DynamoDBAdapterError);
		if (error instanceof DynamoDBAdapterError) {
			expect(error.code).toBe("MISSING_PRIMARY_KEY");
		}
	});

	test("folds writes to a created row into its creation", async () => {
		const state = createTransactionState();
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "user-1", name: "a" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-1", name: "a" },
			next: { id: "user-1", name: "b" },
		});
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "user-2" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-2" },
			next: null,
		});

		expect(await committedItems(state)).toEqual([
			{
				Put: {
					TableName: "users",
					Item: { id: "user-1", name: "b" },
					ConditionExpression: "attribute_not_exists(#pk)",
					ExpressionAttributeNames: { "#pk": "id" },
				},
			},
		]);
	});

	test("updates a stored row with the difference to its final image", async () => {
		const state = createTransactionState();
		const stored = { id: "user-1", name: "a", nickname: "x", visits: 1 };
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: stored,
			next: { ...stored, name: "b" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { ...stored, name: "b" },
			next: { id: "user-1", name: "c", visits: 1 },
		});

		expect(await committedItems(state)).toEqual([
			{
				Update: {
					TableName: "users",
					Key: { id: "user-1" },
					UpdateExpression: "SET #a0 = :v0 REMOVE #a1",
					ConditionExpression: "attribute_exists(#pk)",
					ExpressionAttributeNames: {
						"#a0": "name",
						"#a1": "nickname",
						"#pk": "id",
					},
					ExpressionAttributeValues: { ":v0": "c" },
				},
			},
		]);
	});

	test("omits an empty value map for a remove-only update", async () => {
		const state = createTransactionState();
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-1", nickname: "x" },
			next: { id: "user-1" },
		});

		expect(await committedItems(state)).toEqual([
			{
				Update: {
					TableName: "users",
					Key: { id: "user-1" },
					UpdateExpression: "REMOVE #a0",
					ConditionExpression: "attribute_exists(#pk)",
					ExpressionAttributeNames: { "#a0": "nickname", "#pk": "id" },
				},
			},
		]);
	});

	test("deletes a stored row once, whatever was buffered before", async () => {
		const state = createTransactionState();
		const stored = { id: "user-1", name: "a" };
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: stored,
			next: { id: "user-1", name: "b" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-1", name: "b" },
			next: null,
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: stored,
			next: null,
		});

		expect(await committedItems(state)).toEqual([
			{ Delete: { TableName: "users", Key: { id: "user-1" } } },
		]);
	});

	test("pins attributes of the stored row at commit", async () => {
		const state = createTransactionState();
		const stored = { id: "v1", value: "secret", note: null };
		const consumed = bufferTransactionWrite(state, {
			tableName: "verification",
			keyField: "id",
			row: stored,
			next: null,
		});
		pinTransactionFields(consumed, ["id", "value"]);
		pinTransactionFields(consumed, ["value", "note", "missing"]);

		const counter = { id: "t1", memberCount: 2 };
		const incremented = bufferTransactionWrite(state, {
			tableName: "team",
			keyField: "id",
			row: counter,
			next: { id: "t1", memberCount: 3 },
		});
		pinTransactionFields(incremented, ["memberCount"]);

		expect(await committedItems(state)).toEqual([
			{
				Delete: {
					TableName: "verification",
					Key: { id: "v1" },
					ConditionExpression:
						"attribute_exists(#pk) AND #pin0 = :pin0 AND #pin1 = :pin1 AND #pin2 = :pin2 AND attribute_not_exists(#pin3)",
					ExpressionAttributeNames: {
						"#pk": "id",
						"#pin0": "id",
						"#pin1": "value",
						"#pin2": "note",
						"#pin3": "missing",
					},
					ExpressionAttributeValues: {
						":pin0": "v1",
						":pin1": "secret",
						":pin2": null,
					},
				},
			},
			{
				Update: {
					TableName: "team",
					Key: { id: "t1" },
					UpdateExpression: "SET #a0 = :v0",
					ConditionExpression: "attribute_exists(#pk) AND #pin0 = :pin0",
					ExpressionAttributeNames: {
						"#a0": "memberCount",
						"#pk": "id",
						"#pin0": "memberCount",
					},
					ExpressionAttributeValues: { ":v0": 3, ":pin0": 2 },
				},
			},
		]);
	});

	test("checks the pins of a row that ends up unchanged", async () => {
		const state = createTransactionState();
		const stored = { id: "user-1", name: "a" };
		const entry = bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: stored,
			next: { ...stored },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-2" },
			next: { id: "user-2" },
		});
		pinTransactionFields(entry, ["name"]);

		expect(await committedItems(state)).toEqual([
			{
				ConditionCheck: {
					TableName: "users",
					Key: { id: "user-1" },
					ConditionExpression: "attribute_exists(#pk) AND #pin0 = :pin0",
					ExpressionAttributeNames: { "#pk": "id", "#pin0": "name" },
					ExpressionAttributeValues: { ":pin0": "a" },
				},
			},
		]);
	});

	test("re-creates a row the transaction deleted as an update of the stored row", async () => {
		const state = createTransactionState();
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "user-1", name: "a", nickname: "x" },
			next: null,
		});
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "user-1", name: "b" },
		});

		expect(await committedItems(state)).toEqual([
			{
				Update: {
					TableName: "users",
					Key: { id: "user-1" },
					UpdateExpression: "SET #a0 = :v0 REMOVE #a1",
					ConditionExpression: "attribute_exists(#pk)",
					ExpressionAttributeNames: {
						"#a0": "name",
						"#a1": "nickname",
						"#pk": "id",
					},
					ExpressionAttributeValues: { ":v0": "b" },
				},
			},
		]);
	});

	test("answers reads from the buffered rows", () => {
		const state = createTransactionState();
		bufferTransactionCreate(state, {
			tableName: "users",
			keyField: "id",
			item: { id: "created", role: "admin" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "updated", role: "member" },
			next: { id: "updated", role: "admin" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "demoted", role: "admin" },
			next: { id: "demoted", role: "member" },
		});
		bufferTransactionWrite(state, {
			tableName: "users",
			keyField: "id",
			row: { id: "deleted", role: "admin" },
			next: null,
		});
		bufferTransactionCreate(state, {
			tableName: "sessions",
			keyField: "id",
			item: { id: "session", role: "admin" },
		});

		const admins = applyTransactionOverlay(state, {
			tableName: "users",
			keyField: "id",
			items: [
				{ id: "stored", role: "admin" },
				{ id: "demoted", role: "admin" },
				{ id: "deleted", role: "admin" },
			],
			matches: (row) => row.role === "admin",
		});
		const untouched = applyTransactionOverlay(state, {
			tableName: "accounts",
			keyField: "id",
			items: [{ id: "account" }],
			matches: () => true,
		});

		expect(admins).toEqual([
			{ id: "stored", role: "admin" },
			{ id: "created", role: "admin" },
			{ id: "updated", role: "admin" },
		]);
		expect(untouched).toEqual([{ id: "account" }]);
		expect(hasTransactionItems(state, "users")).toBe(true);
		expect(hasTransactionItems(state, "accounts")).toBe(false);
		expect(
			findTransactionItem(state, {
				tableName: "users",
				keyField: "id",
				keyValue: "deleted",
			})?.current,
		).toBeNull();
		expect(
			findTransactionItem(state, {
				tableName: "sessions",
				keyField: "id",
				keyValue: "deleted",
			}),
		).toBeUndefined();
	});
});
