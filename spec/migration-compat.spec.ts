/**
 * @file Migration compatibility tests.
 * Verifies that generateTableSchemas correctly converts Better Auth schema to DynamoDB.
 * Tests the MECHANISM (unique/index/references → GSI), not individual plugins.
 *
 * Plugin-specific tests should be in separate files (e.g., oidc-provider.spec.ts).
 */
import { getAuthTables } from "@better-auth/core/db";
import {
	bearer,
	captcha,
	emailOTP,
	genericOAuth,
	haveIBeenPwned,
	lastLoginMethod,
	magicLink,
	multiSession,
	oAuthProxy,
	oidcProvider,
	oneTap,
	oneTimeToken,
	openAPI,
	phoneNumber,
	twoFactor,
} from "better-auth/plugins";
import { generateTableSchemas, createIndexResolversFromSchemas } from "../src";

describe("migration compatibility", () => {
	describe("schema conversion mechanism", () => {
		it("converts unique fields to GSIs", () => {
			const schemas = generateTableSchemas({});
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "email" }),
			);
		});

		it("converts indexed fields to GSIs", () => {
			const authTables = getAuthTables({});
			expect(authTables.session.fields.userId.index).toBe(true);

			const schemas = generateTableSchemas({});
			const resolvers = createIndexResolversFromSchemas(schemas);

			expect(resolvers.indexNameResolver({ model: "session", field: "userId" })).toBeDefined();
		});

		it("converts references fields to GSIs (Better Auth sets index: true on references)", () => {
			const options = { plugins: [oidcProvider({ loginPage: "/login" })] };
			const authTables = getAuthTables(options);

			const clientIdField = authTables.oauthAccessToken.fields.clientId;
			expect(clientIdField.references?.model).toBe("oauthApplication");
			expect(clientIdField.index).toBe(true);

			const schemas = generateTableSchemas(options);
			const schema = schemas.find((s) => s.tableName === "oauthAccessToken");
			expect(schema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "clientId" }),
			);
		});

		it("all getAuthTables output tables have corresponding schemas", () => {
			const options = { plugins: [twoFactor(), phoneNumber()] };
			const authTables = getAuthTables(options);
			const schemas = generateTableSchemas(options);

			const authTableNames = Object.keys(authTables);
			const schemaTableNames = schemas.map((s) => s.tableName);

			for (const tableName of authTableNames) {
				expect(schemaTableNames).toContain(tableName);
			}
		});
	});

	describe("plugin patterns", () => {
		it("pattern: new table (twoFactor)", () => {
			const options = { plugins: [twoFactor()] };
			const schemas = generateTableSchemas(options);

			expect(schemas.find((s) => s.tableName === "twoFactor")).toBeDefined();
		});

		it("pattern: user extension (phoneNumber)", () => {
			const options = { plugins: [phoneNumber()] };
			const schemas = generateTableSchemas(options);
			const userSchema = schemas.find((s) => s.tableName === "user");

			expect(userSchema?.indexMappings).toContainEqual(
				expect.objectContaining({ partitionKey: "phoneNumber" }),
			);
		});

		it("pattern: multiple tables (oidcProvider)", () => {
			const options = { plugins: [oidcProvider({ loginPage: "/login" })] };
			const schemas = generateTableSchemas(options);
			const tableNames = schemas.map((s) => s.tableName);

			expect(tableNames).toContain("oauthApplication");
			expect(tableNames).toContain("oauthAccessToken");
			expect(tableNames).toContain("oauthConsent");
		});

		it("pattern: rateLimit with database storage", () => {
			const options = { rateLimit: { storage: "database" as const } };
			const schemas = generateTableSchemas(options);

			expect(schemas.find((s) => s.tableName === "rateLimit")).toBeDefined();
		});

		it("pattern: utility plugins without tables", () => {
			// These plugins add functionality but no new tables
			const coreTables = ["user", "session", "account", "verification"];
			const utilityPlugins = [
				bearer(),
				captcha({ provider: "cloudflare-turnstile", secretKey: "test" }),
				haveIBeenPwned(),
				lastLoginMethod(),
				multiSession(),
				oAuthProxy(),
				oneTimeToken(),
				openAPI(),
			];

			for (const plugin of utilityPlugins) {
				const schemas = generateTableSchemas({ plugins: [plugin] });
				const tableNames = schemas.map((s) => s.tableName);

				// Should only have core tables
				for (const tableName of tableNames) {
					expect(coreTables).toContain(tableName);
				}
			}
		});

		it("pattern: authentication plugins without tables", () => {
			// These authentication plugins don't add new tables or modify user schema
			const coreTables = ["user", "session", "account", "verification"];
			const authPlugins = [
				magicLink({ sendMagicLink: async () => {} }),
				emailOTP({ sendVerificationOTP: async () => {} }),
				genericOAuth({ config: [] }),
				oneTap(),
			];

			for (const plugin of authPlugins) {
				const schemas = generateTableSchemas({ plugins: [plugin] });
				const tableNames = schemas.map((s) => s.tableName);

				// Should only have core tables
				for (const tableName of tableNames) {
					expect(coreTables).toContain(tableName);
				}
			}
		});
	});

	describe("composite GSIs (DynamoDB optimization)", () => {
		it("account: providerId+accountId", () => {
			const schemas = generateTableSchemas({});
			const accountSchema = schemas.find((s) => s.tableName === "account");

			expect(
				accountSchema?.indexMappings.find(
					(m) => m.partitionKey === "providerId" && m.sortKey === "accountId",
				),
			).toBeDefined();
		});

		it("session: userId+createdAt, token+createdAt", () => {
			const schemas = generateTableSchemas({});
			const sessionSchema = schemas.find((s) => s.tableName === "session");

			expect(
				sessionSchema?.indexMappings.find(
					(m) => m.partitionKey === "userId" && m.sortKey === "createdAt",
				),
			).toBeDefined();
			expect(
				sessionSchema?.indexMappings.find(
					(m) => m.partitionKey === "token" && m.sortKey === "createdAt",
				),
			).toBeDefined();
		});

		it("verification: identifier+createdAt", () => {
			const schemas = generateTableSchemas({});
			const verificationSchema = schemas.find((s) => s.tableName === "verification");

			expect(
				verificationSchema?.indexMappings.find(
					(m) => m.partitionKey === "identifier" && m.sortKey === "createdAt",
				),
			).toBeDefined();
		});
	});
});
