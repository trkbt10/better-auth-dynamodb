/**
 * @file Model, table and field naming against DynamoDB Local: the adapter,
 * `generateTableSchemas` and the generated index resolvers have to agree on
 * names for every naming option Better Auth offers.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { dynamodbAdapter } from "../src/adapter";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../src/table-schemas";
import { deleteTables, tableNamesFromSchemas } from "./adapter-test-helpers";
import { localClients } from "./dynamodb-local-environment";

type UserRow = { id: string; email: string; name: string };

type SessionRow = { id: string; userId: string; token: string };

const cases: Array<{
	name: string;
	usePlural: boolean;
	options: BetterAuthOptions;
	userTable: string;
}> = [
	{ name: "default names", usePlural: false, options: {}, userTable: "user" },
	{ name: "usePlural", usePlural: true, options: {}, userTable: "user" },
	{
		name: "custom modelName and fieldName",
		usePlural: false,
		options: {
			user: { modelName: "app_user", fields: { email: "email_address" } },
			session: { modelName: "app_session", fields: { userId: "user_id" } },
		},
		userTable: "app_user",
	},
	{
		name: "usePlural with custom modelName",
		usePlural: true,
		options: { user: { modelName: "member" } },
		userTable: "member",
	},
];

cases.forEach((naming, index) => {
	describe(`model naming on DynamoDB Local: ${naming.name}`, () => {
		const tableNamePrefix = `naming_${index}_`;
		const schemas = generateTableSchemas(naming.options);
		const tables = schemas.map((schema) => ({
			...schema,
			tableName: `${tableNamePrefix}${schema.tableName}`,
		}));
		// No scanMaxPages: a lookup that falls back to a scan throws, so every
		// read below has to be served by the primary key or an index.
		const adapter = dynamodbAdapter({
			documentClient: localClients.documentClient,
			tableNamePrefix,
			usePlural: naming.usePlural,
			...createIndexResolversFromSchemas(schemas),
		})(naming.options);

		beforeAll(async () => {
			await applyTableSchemas({ client: localClients.client, tables });
		});

		afterAll(async () => {
			await deleteTables({
				client: localClients.client,
				tableNames: tableNamesFromSchemas(tables),
			});
		});

		test("names the tables like generateTableSchemas", () => {
			expect(schemas.map((schema) => schema.tableName)).toContain(naming.userTable);
		});

		test("serves lookups by indexed fields and joins from the indexes", async () => {
			const user = await adapter.create<Record<string, unknown>, UserRow>({
				model: "user",
				data: { name: "named", email: "named@example.com" },
			});
			const session = await adapter.create<Record<string, unknown>, SessionRow>({
				model: "session",
				data: {
					userId: user.id,
					token: "named-token",
					expiresAt: new Date("2100-01-01T00:00:00.000Z"),
				},
			});

			const byEmail = await adapter.findOne<UserRow>({
				model: "user",
				where: [{ field: "email", value: "named@example.com" }],
			});
			const byToken = await adapter.findOne<SessionRow>({
				model: "session",
				where: [{ field: "token", value: "named-token" }],
			});
			const joined = await adapter.findOne<UserRow & { session: SessionRow[] }>({
				model: "user",
				where: [{ field: "id", value: user.id }],
				join: { session: true },
			});
			const counted = await adapter.count({
				model: "session",
				where: [{ field: "userId", value: user.id }],
			});

			expect(byEmail).toEqual(user);
			expect(byToken).toEqual(session);
			expect(joined?.session).toEqual([session]);
			expect(counted).toBe(1);
		});
	});
});
