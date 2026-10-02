/**
 * @file Better Auth flows that depend on the adapter's atomic methods, run
 * end to end against DynamoDB Local.
 *
 * Each flow is driven through the public Better Auth API, so the where
 * clauses, guards and transactions are the ones Better Auth itself issues:
 * - password reset: a single-use verification token (consumeOne)
 * - database rate limiting: a guarded request counter (incrementOne)
 * - organization teams: a guarded seat counter (incrementOne)
 */
import { GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { applyTableSchemas } from "../src/apply-table-schemas";
import { dynamodbAdapter } from "../src/adapter";
import {
	createIndexResolversFromSchemas,
	generateTableSchemas,
} from "../src/table-schemas";
import {
	buildTestConfig,
	createTestClients,
	deleteTables,
	tableNamesFromSchemas,
} from "./adapter-test-helpers";
import { signUpAndGetHeaders } from "./plugin-test-utils";

const testConfig = buildTestConfig({
	endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
	accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fakeAccessKeyId",
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fakeSecretAccessKey",
});

const { client, documentClient } = createTestClients(testConfig);

const baseOptions = {
	emailAndPassword: { enabled: true },
	secret: "test-secret-at-least-32-characters-long!!",
	baseURL: "http://localhost:3000",
	trustedOrigins: ["http://localhost:3000"],
} satisfies BetterAuthOptions;

const createEnvironment = <TOptions extends BetterAuthOptions>(props: {
	tableNamePrefix: string;
	transaction: boolean;
	options: TOptions;
}) => {
	const schemas = generateTableSchemas(props.options);
	const tables = schemas.map((schema) => ({
		...schema,
		tableName: `${props.tableNamePrefix}${schema.tableName}`,
	}));
	const auth = betterAuth({
		...props.options,
		database: dynamodbAdapter({
			documentClient,
			tableNamePrefix: props.tableNamePrefix,
			transaction: props.transaction,
			scanMaxPages: 25,
			...createIndexResolversFromSchemas(schemas),
		}),
	});
	return {
		auth,
		setUp: () => applyTableSchemas({ client, tables }),
		tearDown: () =>
			deleteTables({ client, tableNames: tableNamesFromSchemas(tables) }),
	};
};

const captureAsyncError = async (fn: () => Promise<unknown>): Promise<unknown> => {
	try {
		await fn();
	} catch (error) {
		return error;
	}
	return undefined;
};

for (const transaction of [false, true]) {
	describe(`password reset token (transaction: ${transaction})`, () => {
		const tokens = new Map<string, string>();
		const environment = createEnvironment({
			tableNamePrefix: `flow_reset_${transaction}_`,
			transaction,
			options: {
				...baseOptions,
				emailAndPassword: {
					enabled: true,
					sendResetPassword: async ({ user, token }) => {
						tokens.set(user.email, token);
					},
				},
			},
		});
		const { auth } = environment;

		const requestToken = async (email: string): Promise<string> => {
			await signUpAndGetHeaders(auth, email, "Reset");
			await auth.api.requestPasswordReset({
				body: { email, redirectTo: "http://localhost:3000/reset" },
			});
			const token = tokens.get(email);
			if (!token) {
				throw new Error(`No reset token was issued for ${email}.`);
			}
			return token;
		};

		beforeAll(environment.setUp);
		afterAll(environment.tearDown);

		test("resets the password once and rejects the reused token", async () => {
			const email = "reset-once@example.com";
			const token = await requestToken(email);

			const first = await auth.api.resetPassword({
				body: { newPassword: "a-brand-new-password", token },
			});
			const reuse = await captureAsyncError(() =>
				auth.api.resetPassword({
					body: { newPassword: "another-new-password", token },
				}),
			);
			const signIn = await auth.api.signInEmail({
				body: { email, password: "a-brand-new-password" },
			});

			expect(first.status).toBe(true);
			expect(reuse).toMatchObject({ status: "BAD_REQUEST" });
			expect(signIn.user.email).toBe(email);
		});

		test("lets exactly one of several concurrent resets use the token", async () => {
			const email = "reset-race@example.com";
			const token = await requestToken(email);

			const attempts = await Promise.allSettled(
				Array.from({ length: 6 }, (_, index) =>
					auth.api.resetPassword({
						body: { newPassword: `raced-password-${index}`, token },
					}),
				),
			);

			expect(
				attempts.filter((attempt) => attempt.status === "fulfilled"),
			).toHaveLength(1);
		});
	});
}

describe("database rate limiting", () => {
	const max = 3;
	const environment = createEnvironment({
		tableNamePrefix: "flow_rate_limit_",
		transaction: false,
		options: {
			...baseOptions,
			rateLimit: { enabled: true, storage: "database", window: 60, max },
			advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
		},
	});
	const { auth } = environment;

	const requestFrom = async (ip: string): Promise<number> => {
		const response = await auth.handler(
			new Request("http://localhost:3000/api/auth/ok", {
				headers: { "x-forwarded-for": ip },
			}),
		);
		return response.status;
	};

	const readCounters = async (): Promise<Record<string, unknown>[]> => {
		const output = await documentClient.send(
			new ScanCommand({ TableName: "flow_rate_limit_rateLimit" }),
		);
		return output.Items ?? [];
	};

	beforeAll(environment.setUp);
	afterAll(environment.tearDown);

	test("counts sequential requests and rejects the ones over the limit", async () => {
		const statuses = [
			await requestFrom("203.0.113.10"),
			await requestFrom("203.0.113.10"),
			await requestFrom("203.0.113.10"),
			await requestFrom("203.0.113.10"),
			await requestFrom("203.0.113.10"),
		];

		expect(statuses).toEqual([200, 200, 200, 429, 429]);
		const counters = await readCounters();
		expect(
			counters.filter((row) => String(row.key).startsWith("203.0.113.10")),
		).toMatchObject([{ count: max }]);
	});

	test("never admits more than the limit under concurrent requests", async () => {
		// The first request creates the counter row; the burst then races on it.
		expect(await requestFrom("203.0.113.20")).toBe(200);

		const statuses = await Promise.all(
			Array.from({ length: 12 }, () => requestFrom("203.0.113.20")),
		);

		expect(statuses.filter((status) => status === 200)).toHaveLength(max - 1);
		expect(statuses.filter((status) => status === 429)).toHaveLength(
			12 - (max - 1),
		);
		const counters = await readCounters();
		expect(
			counters.filter((row) => String(row.key).startsWith("203.0.113.20")),
		).toMatchObject([{ count: max }]);
	});
});

for (const transaction of [false, true]) {
	describe(`organization team seats (transaction: ${transaction})`, () => {
		const maximumMembersPerTeam = 2;
		const tableNamePrefix = `flow_team_${transaction}_`;
		const environment = createEnvironment({
			tableNamePrefix,
			transaction,
			options: {
				...baseOptions,
				plugins: [
					organization({
						allowUserToCreateOrganization: true,
						teams: { enabled: true, maximumMembersPerTeam },
					}),
				],
			},
		});
		const { auth } = environment;

		const readMemberCount = async (teamId: string): Promise<unknown> => {
			const output = await documentClient.send(
				new GetCommand({
					TableName: `${tableNamePrefix}team`,
					Key: { id: teamId },
					ConsistentRead: true,
				}),
			);
			return output.Item?.memberCount;
		};

		beforeAll(environment.setUp);
		afterAll(environment.tearDown);

		test("fills a team up to its seat limit and no further", async () => {
			const owner = await signUpAndGetHeaders(
				auth,
				`owner-${transaction}@example.com`,
				"Owner",
			);
			const members = [
				await signUpAndGetHeaders(auth, `m1-${transaction}@example.com`, "M1"),
				await signUpAndGetHeaders(auth, `m2-${transaction}@example.com`, "M2"),
				await signUpAndGetHeaders(auth, `m3-${transaction}@example.com`, "M3"),
			];
			const created = await auth.api.createOrganization({
				body: { name: "Seats", slug: `seats-${transaction}` },
				headers: owner.headers,
			});
			const organizationId = created.id;
			for (const member of members) {
				await auth.api.addMember({
					body: { userId: member.user.id, role: "member", organizationId },
				});
			}
			const team = await auth.api.createTeam({
				body: { name: "Engineering", organizationId },
				headers: owner.headers,
			});
			const addToTeam = (userId: string) =>
				auth.api.addTeamMember({
					body: { teamId: team.id, userId },
					headers: owner.headers,
				});

			await addToTeam(members[0].user.id);
			await addToTeam(members[1].user.id);
			const overflow = await captureAsyncError(() =>
				addToTeam(members[2].user.id),
			);

			expect(overflow).toMatchObject({ status: "FORBIDDEN" });
			expect(await readMemberCount(team.id)).toBe(maximumMembersPerTeam);

			await auth.api.removeTeamMember({
				body: { teamId: team.id, userId: members[0].user.id },
				headers: owner.headers,
			});
			expect(await readMemberCount(team.id)).toBe(maximumMembersPerTeam - 1);

			await addToTeam(members[2].user.id);
			expect(await readMemberCount(team.id)).toBe(maximumMembersPerTeam);
		});
	});
}
