/**
 * @file Tests for the null handling of index key attributes.
 */
import { getAuthTables } from "@better-auth/core/db";
import {
	createIndexKeyAttributeResolver,
	omitNullIndexKeys,
	restoreNullIndexKeys,
} from "./index-key-attributes";

describe("createIndexKeyAttributeResolver", () => {
	const schema = getAuthTables({
		session: { fields: { userId: "user_id" } },
	});
	const calls: string[] = [];
	const resolve = createIndexKeyAttributeResolver({
		schema,
		getDefaultModelName: (model) => model,
		indexNameResolver: ({ model, field }) => {
			calls.push(`${model}:${field}`);
			if (model === "session" && field === "user_id") {
				return "session_user_id_createdAt_idx";
			}
			if (model === "session" && field === "token") {
				return "session_token_idx";
			}
			return undefined;
		},
		indexKeySchemaResolver: ({ indexName }) => {
			if (indexName === "session_user_id_createdAt_idx") {
				return { partitionKey: "user_id", sortKey: "createdAt" };
			}
			return undefined;
		},
	});

	test("lists partition and sort keys under their attribute names", () => {
		expect(resolve("session").sort()).toEqual(["createdAt", "token", "user_id"]);
		expect(resolve("verification")).toEqual([]);
		expect(resolve("unknown-model")).toEqual([]);
	});

	test("resolves a model once", () => {
		const before = calls.length;
		resolve("session");
		expect(calls.length).toBe(before);
	});
});

describe("omitNullIndexKeys / restoreNullIndexKeys", () => {
	test("drops null index key attributes only", () => {
		const row = { id: "d1", ownerId: null, note: null, label: "x" };

		expect(omitNullIndexKeys(row, ["ownerId"])).toEqual({
			id: "d1",
			note: null,
			label: "x",
		});
		expect(omitNullIndexKeys(row, [])).toBe(row);
		expect(omitNullIndexKeys({ id: "d1", ownerId: "u1" }, ["ownerId"])).toEqual({
			id: "d1",
			ownerId: "u1",
		});
	});

	test("reports missing index key attributes as null", () => {
		const row = { id: "d1", label: "x" };

		expect(restoreNullIndexKeys(row, ["ownerId", "groupId"])).toEqual({
			id: "d1",
			label: "x",
			ownerId: null,
			groupId: null,
		});
		expect(restoreNullIndexKeys(row, ["ownerId", "groupId"], ["groupId"])).toEqual({
			id: "d1",
			label: "x",
			groupId: null,
		});
		expect(restoreNullIndexKeys({ id: "d1", ownerId: "u1" }, ["ownerId"])).toEqual({
			id: "d1",
			ownerId: "u1",
		});
		expect(restoreNullIndexKeys(row, [])).toBe(row);
	});
});
