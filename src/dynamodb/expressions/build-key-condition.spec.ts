/**
 * @file Tests for key condition builder.
 */
import type { DynamoDBWhere } from "../types";
import {
	buildKeyCondition,
	hasKeyAttributeFilter,
	selectQueryFilterWhere,
} from "./build-key-condition";

describe("buildKeyCondition", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const indexNameResolver = (props: { model: string; field: string }) =>
		`${props.model}_${props.field}_index`;
	const indexNameResolverNone = () => undefined;

	test("returns null when index name resolver has no match", () => {
		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = buildKeyCondition({
			model: "user",
			where,
			getFieldName,
			indexNameResolver: indexNameResolverNone,
		});

		expect(result).toBeNull();
	});

	test("builds key condition for id eq with extra filters", () => {
		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "user-1" },
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = buildKeyCondition({
			model: "user",
			where,
			getFieldName,
			indexNameResolver,
		});

		expect(result).toEqual({
			keyConditionExpression: "#pk = :pk",
			expressionAttributeNames: { "#pk": "id" },
			expressionAttributeValues: { ":pk": "user-1" },
			remainingWhere: [
				{ field: "email", operator: "eq", value: "a@example.com" },
			],
			keyAttributes: ["id"],
		});
	});

	test("builds key condition for indexed field", () => {
		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = buildKeyCondition({
			model: "user",
			where,
			getFieldName,
			indexNameResolver,
		});

		expect(result).toEqual({
			keyConditionExpression: "#pk = :pk",
			expressionAttributeNames: { "#pk": "email" },
			expressionAttributeValues: { ":pk": "a@example.com" },
			indexName: "user_email_index",
			remainingWhere: [],
			keyAttributes: ["email"],
		});
	});

	test("includes sort key when schema and where allow it", () => {
		const where: DynamoDBWhere[] = [
			{ field: "providerId", operator: "eq", value: "github" },
			{ field: "accountId", operator: "eq", value: "account_1" },
		];
		const result = buildKeyCondition({
			model: "account",
			where,
			getFieldName,
			indexNameResolver: (props) => {
				if (props.model === "account" && props.field === "providerId") {
					return "account_providerId_accountId_idx";
				}
				return undefined;
			},
			indexKeySchemaResolver: (props) => {
				if (
					props.model === "account" &&
					props.indexName === "account_providerId_accountId_idx"
				) {
					return { partitionKey: "providerId", sortKey: "accountId" };
				}
				return undefined;
			},
		});

		expect(result).toEqual({
			keyConditionExpression: "#pk = :pk AND #sk = :sk",
			expressionAttributeNames: {
				"#pk": "providerId",
				"#sk": "accountId",
			},
			expressionAttributeValues: {
				":pk": "github",
				":sk": "account_1",
			},
			indexName: "account_providerId_accountId_idx",
			remainingWhere: [],
			keyAttributes: ["providerId", "accountId"],
		});
	});

	test("prefers composite index when multiple indexed fields exist", () => {
		const where: DynamoDBWhere[] = [
			{ field: "accountId", operator: "eq", value: "account_1" },
			{ field: "providerId", operator: "eq", value: "github" },
		];
		const result = buildKeyCondition({
			model: "account",
			where,
			getFieldName,
			indexNameResolver: (props) => {
				if (props.model === "account" && props.field === "accountId") {
					return "account_accountId_idx";
				}
				if (props.model === "account" && props.field === "providerId") {
					return "account_providerId_accountId_idx";
				}
				return undefined;
			},
			indexKeySchemaResolver: (props) => {
				if (
					props.model === "account" &&
					props.indexName === "account_providerId_accountId_idx"
				) {
					return { partitionKey: "providerId", sortKey: "accountId" };
				}
				return undefined;
			},
		});

		expect(result).toEqual({
			keyConditionExpression: "#pk = :pk AND #sk = :sk",
			expressionAttributeNames: {
				"#pk": "providerId",
				"#sk": "accountId",
			},
			expressionAttributeValues: {
				":pk": "github",
				":sk": "account_1",
			},
			indexName: "account_providerId_accountId_idx",
			remainingWhere: [],
			keyAttributes: ["providerId", "accountId"],
		});
	});

		test("builds key condition when OR connector is only in filters", () => {
			const where: DynamoDBWhere[] = [
				{ field: "id", operator: "eq", value: "user-1" },
				{
					field: "email",
				operator: "eq",
				value: "a@example.com",
				connector: "OR",
			},
		];
			const result = buildKeyCondition({
				model: "user",
				where,
				getFieldName,
				indexNameResolver,
			});

			expect(result).toEqual({
				keyConditionExpression: "#pk = :pk",
				expressionAttributeNames: { "#pk": "id" },
				expressionAttributeValues: { ":pk": "user-1" },
				remainingWhere: [
					{
						field: "email",
						operator: "eq",
						value: "a@example.com",
						connector: "OR",
					},
				],
				keyAttributes: ["id"],
			});
		});
		test("does not use a null or case-insensitive entry as the key condition", () => {
		const byNull = buildKeyCondition({
			model: "user",
			where: [{ field: "email", operator: "eq", value: null }],
			getFieldName,
			indexNameResolver,
		});
		const insensitive = buildKeyCondition({
			model: "user",
			where: [
				{ field: "id", operator: "eq", value: "User-1", mode: "insensitive" },
			],
			getFieldName,
			indexNameResolver,
		});

		expect(byNull).toBeNull();
		expect(insensitive).toBeNull();
	});

	test("keeps key attributes out of the query filter", () => {
		const keyAttributes = ["identifier", "createdAt"];
		const select = (where: DynamoDBWhere[]) =>
			selectQueryFilterWhere({
				model: "verification",
				where,
				keyAttributes,
				getFieldName,
			});
		const value: DynamoDBWhere = { field: "value", operator: "eq", value: "v" };
		const range: DynamoDBWhere = { field: "createdAt", operator: "gt", value: "2024" };
		const orValue: DynamoDBWhere = { ...value, connector: "OR" };
		const orKey: DynamoDBWhere = {
			field: "identifier",
			operator: "eq",
			value: "other",
			connector: "OR",
		};

		expect(select([value, orValue])).toEqual([value, orValue]);
		expect(select([value, range])).toEqual([value]);
		expect(select([value, range, orValue])).toEqual([value, orValue]);
		expect(select([value, orValue, orKey])).toEqual([value]);
		expect(
			hasKeyAttributeFilter({
				model: "verification",
				where: [value, range],
				keyAttributes,
				getFieldName,
			}),
		).toBe(true);
		expect(
			hasKeyAttributeFilter({
				model: "verification",
				where: [value],
				keyAttributes,
				getFieldName,
			}),
		).toBe(false);
	});
});
