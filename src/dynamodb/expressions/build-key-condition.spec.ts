/**
 * @file Tests for key condition builder.
 */
import type { DynamoDBWhere } from "../types";
import { buildKeyCondition } from "./build-key-condition";

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
		});
	});

	test("skips key condition when OR connector is present", () => {
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

		expect(result).toBeNull();
	});
});
