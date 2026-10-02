/**
 * @file Tests for the query plan explain output.
 */
import type { JoinConfig, Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { buildQueryPlan } from "../planner/build-query-plan";
import {
	formatAdapterQueryPlan,
	formatPrimaryKeyLookupPlan,
} from "./format-query-plan";

describe("formatAdapterQueryPlan", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;
	const indexNameResolver = (props: { model: string; field: string }) => {
		if (props.field === "email") {
			return `${props.model}_email_idx`;
		}
		return undefined;
	};

	const buildAdapterConfig = (
		overrides: Partial<ResolvedDynamoDBAdapterConfig> = {},
	): ResolvedDynamoDBAdapterConfig => ({
		documentClient: createDocumentClientStub({ respond: async () => ({}) })
			.documentClient,
		usePlural: false,
		debugLogs: undefined,
		tableNamePrefix: "auth_",
		scanMaxPages: 5,
		scanPageLimitMode: "throw",
		explainQueryPlans: true,
		explainDynamoOperations: false,
		indexNameResolver,
		indexKeySchemaResolver: undefined,
		transaction: false,
		...overrides,
	});

	const explain = (props: {
		where?: Where[] | undefined;
		select?: string[] | undefined;
		sortBy?: { field: string; direction: "asc" | "desc" } | undefined;
		limit?: number | undefined;
		offset?: number | undefined;
		join?: JoinConfig | undefined;
		adapterConfig?: ResolvedDynamoDBAdapterConfig | undefined;
	}): string => {
		const adapterConfig = props.adapterConfig ?? buildAdapterConfig();
		return formatAdapterQueryPlan({
			plan: buildQueryPlan({
				model: "user",
				where: props.where,
				select: props.select,
				sortBy: props.sortBy,
				limit: props.limit,
				offset: props.offset,
				join: props.join,
				getFieldName,
				adapterConfig,
			}),
			adapterConfig,
			getDefaultModelName,
		});
	};

	test("explains a primary key query", () => {
		expect(explain({ where: [{ field: "id", value: "u1" }], limit: 1 })).toBe(
			[
				"EXPLAIN DynamoDBAdapter",
				"QUERY model=user",
				"WHERE",
				'  AND id eq "u1"',
				"PLAN",
				"  -> PROJECT (*)",
				"    -> QUERY(PK) table=auth_user fetchLimit=1 scanMaxPages=n/a scanPageLimitMode=throw",
				"       est: QueryCommand: >=1",
				"    -> LIMIT offset=0 limit=1",
			].join("\n"),
		);
	});

	test("explains an index query with projection, client sort and offset", () => {
		expect(
			explain({
				where: [{ field: "email", value: "a@example.com" }],
				select: ["id", "email"],
				sortBy: { field: "name", direction: "asc" },
				offset: 2,
			}),
		).toBe(
			[
				"EXPLAIN DynamoDBAdapter",
				"QUERY model=user",
				"WHERE",
				'  AND email eq "a@example.com"',
				"PLAN",
				"  -> PROJECT (id, email)",
				"    -> QUERY(GSI:USER_EMAIL_IDX) table=auth_user fetchLimit=∞ scanMaxPages=n/a scanPageLimitMode=throw",
				"       est: QueryCommand: >=1",
				"    -> SORT (client)",
				"    -> LIMIT offset=2 limit=∞",
			].join("\n"),
		);
	});

	test("explains a multi-query over an indexed IN list", () => {
		const output = explain({
			where: [
				{
					field: "email",
					operator: "in",
					value: ["a@example.com", "b@example.com"],
				},
			],
		});

		expect(output).toContain('  AND email in ["a@example.com", "b@example.com"]');
		expect(output).toContain("-> MULTI-QUERY(GSI:USER_EMAIL_IDX) table=auth_user");
		expect(output).toContain("est: QueryCommand: =2");
	});

	test("explains a batch get over a primary key IN list", () => {
		const output = explain({
			where: [{ field: "id", operator: "in", value: ["u1", "u2", "u3"] }],
		});

		expect(output).toContain("-> BATCH-GET(PK) table=auth_user");
		expect(output).toContain("est: BatchGetCommand: =1 (chunks=1)");
	});

	test("explains a scan with its page budget and client filtering", () => {
		const output = explain({
			where: [
				{ field: "name", operator: "ends_with", value: "son" },
				{ field: "banned", value: true, connector: "OR" },
				{ field: "deletedAt", value: null, connector: "OR" },
			],
		});

		expect(output).toBe(
			[
				"EXPLAIN DynamoDBAdapter",
				"QUERY model=user",
				"WHERE",
				'  AND name ends_with "son"',
				"  OR banned eq true",
				"  OR deletedAt eq null",
				"PLAN",
				"  -> PROJECT (*)",
				"    -> SCAN table=auth_user fetchLimit=∞ scanMaxPages=5 scanPageLimitMode=throw",
				"       est: ScanCommand: <=5",
				"    -> FILTER (client) or=true clientOnly=true",
			].join("\n"),
		);
	});

	test("explains scans without a page budget", () => {
		const unbounded = explain({
			adapterConfig: buildAdapterConfig({ scanPageLimitMode: "unbounded" }),
		});
		const unknown = explain({
			adapterConfig: buildAdapterConfig({ scanMaxPages: undefined }),
		});
		const infinite = explain({
			adapterConfig: buildAdapterConfig({
				scanMaxPages: Number.POSITIVE_INFINITY,
			}),
		});

		expect(unbounded).toContain("WHERE (none)");
		expect(unbounded).toContain("est: ScanCommand: unbounded");
		expect(unknown).toContain("scanMaxPages=∞");
		expect(unknown).toContain("est: ScanCommand: unknown");
		expect(infinite).toContain("est: ScanCommand: unbounded");
	});

	test("explains joins and nests the base lookup under them", () => {
		const output = explain({
			where: [{ field: "id", value: "u1" }],
			join: {
				session: {
					on: { from: "id", to: "userId" },
					relation: "one-to-many",
				},
				profile: {
					on: { from: "profileId", to: "id" },
					relation: "one-to-one",
				},
			},
		});

		expect(output).toContain(
			"-> JOIN session relation=one-to-many on id = userId strategy=scan table=auth_session",
		);
		expect(output).toContain(
			"-> JOIN profile relation=one-to-one on profileId = id strategy=query(pk) table=auth_profile",
		);
		expect(output).toContain("note: uses BATCH-GET when >1 distinct key");
		expect(output).toContain("-> QUERY(PK) table=auth_user");
	});

	test("prints values that are not primitives as an ellipsis", () => {
		const output = explain({
			where: [{ field: "createdAt", operator: "gt", value: new Date(0) }],
		});

		expect(output).toContain("  AND createdAt gt …");
	});
});

describe("formatPrimaryKeyLookupPlan", () => {
	test("explains a single key lookup", () => {
		expect(
			formatPrimaryKeyLookupPlan({
				model: "user",
				tableName: "auth_user",
				keyField: "id",
				key: "u1",
			}),
		).toBe(
			[
				"EXPLAIN DynamoDBAdapter",
				"QUERY model=user",
				"WHERE",
				'  AND id eq "u1"',
				"PLAN",
				"  -> PROJECT (*)",
				"    -> BATCH-GET table=auth_user key=id keys=1 chunks=1",
			].join("\n"),
		);
	});
});
