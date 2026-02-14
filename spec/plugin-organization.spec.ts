/**
 * @file Integration tests for the Organization plugin with DynamoDB adapter.
 *
 * Covers: organization, member, invitation, team, teamMember.
 */
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { admin } from "better-auth/plugins/admin";
import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { dynamodbAdapter } from "../src/adapter";
import { createStatefulDocumentClient } from "./stateful-document-client";
import { signUpAndGetHeaders } from "./plugin-test-utils";
import {
	generateTableSchemas,
	createIndexResolversFromSchemas,
} from "../src/table-schemas";

const createPlugins = (teams: boolean) => [
	organization({
		allowUserToCreateOrganization: true,
		teams: teams ? { enabled: true } : undefined,
	}),
	admin(),
];

const createAuth = (
	documentClient: ReturnType<typeof createStatefulDocumentClient>["documentClient"],
	transaction: boolean,
	teams = false,
) => {
	const plugins = createPlugins(teams);
	const schemas = generateTableSchemas({ plugins });
	const resolvers = createIndexResolversFromSchemas(schemas);

	return betterAuth({
		database: dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			transaction,
			scanMaxPages: 1,
			...resolvers,
		}),
		plugins,
		emailAndPassword: { enabled: true },
		secret: "test-secret-at-least-32-characters-long!!",
		baseURL: "http://localhost:3000",
		trustedOrigins: ["http://localhost:3000"],
	});
};

describe("Organization plugin (transaction: true)", () => {
	test("creates an organization", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"alice@example.com",
			"Alice",
		);

		const result = await auth.api.createOrganization({
			body: { name: "Test Org", slug: "test-org" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result!.id).toBeDefined();
		expect(result!.name).toBe("Test Org");
		expect(result!.slug).toBe("test-org");
	});

	test("lists organizations after creation", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"bob@example.com",
			"Bob",
		);

		await auth.api.createOrganization({
			body: { name: "Org One", slug: "org-one" },
			headers,
		});

		const list = await auth.api.listOrganizations({ headers });

		expect(Array.isArray(list)).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(1);
		expect(list.some((o) => o.slug === "org-one")).toBe(true);
	});

	test("creates an invitation", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"carol@example.com",
			"Carol",
		);

		const org = await auth.api.createOrganization({
			body: { name: "Invite Org", slug: "invite-org" },
			headers,
		});

		const invitation = await auth.api.createInvitation({
			body: {
				organizationId: org!.id,
				email: "invitee@example.com",
				role: "member",
			},
			headers,
		});

		expect(invitation).toBeDefined();
		expect(invitation.email).toBe("invitee@example.com");
		expect(invitation.role).toBe("member");
		expect(invitation.status).toBe("pending");
	});

	test("creates a team within organization", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, true, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"dave@example.com",
			"Dave",
		);

		const org = await auth.api.createOrganization({
			body: { name: "Team Org", slug: "team-org" },
			headers,
		});

		// @ts-expect-error createTeam is available at runtime when teams option is enabled
		const team = await auth.api.createTeam({
			body: {
				name: "Engineering",
				organizationId: org!.id,
			},
			headers,
		});

		expect(team).toBeDefined();
		expect(team.name).toBe("Engineering");
		expect(team.id).toBeDefined();
	});
});

describe("Organization plugin (transaction: false)", () => {
	test("creates an organization", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"eve@example.com",
			"Eve",
		);

		const result = await auth.api.createOrganization({
			body: { name: "No-Tx Org", slug: "no-tx-org" },
			headers,
		});

		expect(result).toBeDefined();
		expect(result!.id).toBeDefined();
		expect(result!.name).toBe("No-Tx Org");

		// Direct PutCommand writes used
		const putCommands = sendCalls.filter(
			(c) => c instanceof PutCommand,
		);
		expect(putCommands.length).toBeGreaterThan(0);
	});

	test("lists organizations using QueryCommand with member_userId GSI", async () => {
		const { documentClient, sendCalls } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"frank@example.com",
			"Frank",
		);

		await auth.api.createOrganization({
			body: { name: "Org Two", slug: "org-two" },
			headers,
		});

		// Clear sendCalls to track only listOrganizations
		sendCalls.length = 0;

		const list = await auth.api.listOrganizations({ headers });

		expect(Array.isArray(list)).toBe(true);
		expect(list.length).toBeGreaterThanOrEqual(1);
		expect(list.some((o) => o.slug === "org-two")).toBe(true);

		// Verify QueryCommand was used with member_userId_idx GSI
		const queryCalls = sendCalls.filter((c) => c instanceof QueryCommand);
		const memberQuery = queryCalls.find((c) => {
			const cmd = c as QueryCommand;
			return cmd.input.IndexName === "member_userId_idx";
		});
		expect(memberQuery).toBeDefined();
	});

	test("creates an invitation without transaction", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"grace@example.com",
			"Grace",
		);

		const org = await auth.api.createOrganization({
			body: { name: "Inv Org", slug: "inv-org" },
			headers,
		});

		const invitation = await auth.api.createInvitation({
			body: {
				organizationId: org!.id,
				email: "guest@example.com",
				role: "member",
			},
			headers,
		});

		expect(invitation).toBeDefined();
		expect(invitation.email).toBe("guest@example.com");
		expect(invitation.role).toBe("member");
	});

	test("creates a team within organization without transaction", async () => {
		const { documentClient } = createStatefulDocumentClient();
		const auth = createAuth(documentClient, false, true);

		const { headers } = await signUpAndGetHeaders(
			auth,
			"hank@example.com",
			"Hank",
		);

		const org = await auth.api.createOrganization({
			body: { name: "Team Org 2", slug: "team-org-2" },
			headers,
		});

		// @ts-expect-error createTeam is available at runtime when teams option is enabled
		const team = await auth.api.createTeam({
			body: {
				name: "Backend",
				organizationId: org!.id,
			},
			headers,
		});

		expect(team).toBeDefined();
		expect(team.name).toBe("Backend");
		expect(team.id).toBeDefined();
	});
});
