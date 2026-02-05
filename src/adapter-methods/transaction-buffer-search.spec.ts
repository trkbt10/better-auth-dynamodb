/**
 * @file Tests for transaction buffer search.
 */
import type { Where } from "@better-auth/core/db/adapter";
import { createTransactionState, addTransactionOperation } from "../dynamodb/ops/transaction";
import { searchTransactionBuffer } from "./transaction-buffer-search";

describe("searchTransactionBuffer", () => {
	test("returns matching PUT item for where clause", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "user",
			item: { id: "u1", email: "alice@example.com" },
		});

		const where: Where[] = [{ field: "id", operator: "eq", value: "u1" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: true, item: { id: "u1", email: "alice@example.com" } });
	});

	test("returns found false when no PUT items match", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "user",
			item: { id: "u1", email: "alice@example.com" },
		});

		const where: Where[] = [{ field: "id", operator: "eq", value: "u999" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: false });
	});

	test("returns found false when PUT is for a different table", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "session",
			item: { id: "s1", userId: "u1" },
		});

		const where: Where[] = [{ field: "id", operator: "eq", value: "s1" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: false });
	});

	test("returns found false when buffer is empty", () => {
		const state = createTransactionState();

		const where: Where[] = [{ field: "id", operator: "eq", value: "u1" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: false });
	});

	test("returns the last matching PUT item when multiple match", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "user",
			item: { id: "u1", name: "first" },
		});
		addTransactionOperation(state, {
			kind: "put",
			tableName: "user",
			item: { id: "u1", name: "second" },
		});

		const where: Where[] = [{ field: "id", operator: "eq", value: "u1" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: true, item: { id: "u1", name: "second" } });
	});

	test("ignores update and delete operations", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "update",
			tableName: "user",
			key: { id: "u1" },
			updateExpression: "SET #n = :n",
			expressionAttributeNames: { "#n": "name" },
			expressionAttributeValues: { ":n": "updated" },
		});
		addTransactionOperation(state, {
			kind: "delete",
			tableName: "user",
			key: { id: "u2" },
		});

		const where: Where[] = [{ field: "id", operator: "eq", value: "u1" }];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "user",
			where,
		});

		expect(result).toEqual({ found: false });
	});

	test("matches with multiple AND conditions", () => {
		const state = createTransactionState();
		addTransactionOperation(state, {
			kind: "put",
			tableName: "account",
			item: { id: "a1", providerId: "github", accountId: "gh-123" },
		});

		const where: Where[] = [
			{ field: "providerId", operator: "eq", value: "github" },
			{ field: "accountId", operator: "eq", value: "gh-123" },
		];
		const result = searchTransactionBuffer({
			transactionState: state,
			tableName: "account",
			where,
		});

		expect(result).toEqual({
			found: true,
			item: { id: "a1", providerId: "github", accountId: "gh-123" },
		});
	});
});
