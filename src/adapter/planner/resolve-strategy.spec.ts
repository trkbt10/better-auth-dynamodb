/**
 * @file Tests for planner strategy resolution aligned with Better Auth schema.
 */
import { getAuthTables } from "@better-auth/core/db";
import { initGetFieldName } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "@better-auth/core";
import { resolveBaseStrategy, resolveJoinStrategyHint } from "./resolve-strategy";

const buildSchemaHelpers = () => {
	const options: BetterAuthOptions = {};
	const schema = getAuthTables(options);
	const getFieldName = initGetFieldName({
		schema,
		usePlural: false,
	});
	return {
		getFieldName,
	};
};

const indexNameResolver = (props: { model: string; field: string }) => {
	if (props.model === "session" && props.field === "userId") {
		return "session_userId_idx";
	}
	if (props.model === "account" && props.field === "userId") {
		return "account_userId_idx";
	}
	if (props.model === "verification" && props.field === "identifier") {
		return "verification_identifier_idx";
	}
	return undefined;
};

describe("resolveBaseStrategy", () => {
	const helpers = buildSchemaHelpers();

	test("uses PK query for id equality", () => {
		const idField = helpers.getFieldName({ model: "user", field: "id" });
		const result = resolveBaseStrategy({
			model: "user",
			where: [
				{
					field: idField,
					operator: "eq",
					value: "id_1",
					connector: "AND",
					requiresClientFilter: false,
				},
			],
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
			hasOrConnector: false,
		});

		expect(result).toEqual({ kind: "query", key: "pk" });
	});

	test("uses GSI query for indexed fields", () => {
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const result = resolveBaseStrategy({
			model: "session",
			where: [
				{
					field: userIdField,
					operator: "eq",
					value: "user_1",
					connector: "AND",
					requiresClientFilter: false,
				},
			],
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
			hasOrConnector: false,
		});

		expect(result).toEqual({
			kind: "query",
			key: "gsi",
			indexName: "session_userId_idx",
		});
	});

	test("uses batch-get for id IN lists", () => {
		const idField = helpers.getFieldName({ model: "user", field: "id" });
		const result = resolveBaseStrategy({
			model: "user",
			where: [
				{
					field: idField,
					operator: "in",
					value: ["id_1", "id_2"],
					connector: "AND",
					requiresClientFilter: false,
				},
			],
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
			hasOrConnector: false,
		});

		expect(result).toEqual({ kind: "batch-get" });
	});

	test("falls back to scan for OR connectors", () => {
		const emailField = helpers.getFieldName({ model: "user", field: "email" });
		const result = resolveBaseStrategy({
			model: "user",
			where: [
				{
					field: emailField,
					operator: "eq",
					value: "a@example.com",
					connector: "OR",
					requiresClientFilter: false,
				},
				{
					field: emailField,
					operator: "eq",
					value: "b@example.com",
					connector: "OR",
					requiresClientFilter: false,
				},
			],
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
			hasOrConnector: true,
		});

		expect(result).toEqual({ kind: "scan" });
	});

	test("falls back to scan for non-indexed fields", () => {
		const nameField = helpers.getFieldName({ model: "user", field: "name" });
		const result = resolveBaseStrategy({
			model: "user",
			where: [
				{
					field: nameField,
					operator: "eq",
					value: "user",
					connector: "AND",
					requiresClientFilter: false,
				},
			],
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
			hasOrConnector: false,
		});

		expect(result).toEqual({ kind: "scan" });
	});
});

describe("resolveJoinStrategyHint", () => {
	const helpers = buildSchemaHelpers();

	test("uses GSI hint for session.userId joins", () => {
		const userIdField = helpers.getFieldName({
			model: "session",
			field: "userId",
		});
		const result = resolveJoinStrategyHint({
			joinField: userIdField,
			model: "session",
			getFieldName: helpers.getFieldName,
			adapterConfig: { indexNameResolver },
		});

		expect(result).toEqual({
			kind: "query",
			key: "gsi",
			indexName: "session_userId_idx",
		});
	});
});
