/**
 * @file Shared test utilities for Better Auth plugin integration tests.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { dynamodbAdapter } from "../src/adapter";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

type CreateTestAuthOptions = {
	documentClient: DynamoDBDocumentClient;
	transaction: boolean;
	plugins: BetterAuthPlugin[];
	databaseHooks?: Parameters<typeof betterAuth>[0]["databaseHooks"];
};

export const createTestAuth = (options: CreateTestAuthOptions) =>
	betterAuth({
		database: dynamodbAdapter({
			documentClient: options.documentClient,
			tableNamePrefix: "auth_",
			transaction: options.transaction,
			scanMaxPages: 1,
			indexNameResolver: () => undefined,
		}),
		plugins: options.plugins,
		emailAndPassword: { enabled: true },
		secret: "test-secret-at-least-32-characters-long!!",
		baseURL: "http://localhost:3000",
		trustedOrigins: ["http://localhost:3000"],
		databaseHooks: options.databaseHooks,
	});

/**
 * Parse `Set-Cookie` header to extract a named cookie value.
 *
 * Handles multiple cookies separated by commas (accounting for date
 * values that also contain commas by splitting on `, ` followed by a
 * token= pattern).
 */
const extractCookieValue = (
	setCookieHeader: string,
	cookieName: string,
): string | undefined => {
	const cookies = setCookieHeader.split(/,\s*(?=\w+=)/);
	for (const cookie of cookies) {
		const trimmed = cookie.trim();
		const prefix = `${cookieName}=`;
		if (trimmed.startsWith(prefix)) {
			const rest = trimmed.slice(prefix.length);
			const semiIndex = rest.indexOf(";");
			if (semiIndex < 0) {
				return rest;
			}
			return rest.slice(0, semiIndex);
		}
	}
	return undefined;
};

export const signUpAndGetHeaders = async (
	auth: {
		api: {
			signUpEmail: (opts: {
				body: { email: string; password: string; name: string };
				asResponse: true;
			}) => Promise<Response>;
		};
	},
	email: string,
	name: string,
): Promise<{
	user: { id: string; email: string; name: string };
	token: string;
	headers: Headers;
}> => {
	const response = await auth.api.signUpEmail({
		body: {
			email,
			password: "securepassword123",
			name,
		},
		asResponse: true,
	});

	const setCookieHeader = response.headers.get("set-cookie") ?? "";
	const signedToken = extractCookieValue(
		setCookieHeader,
		"better-auth.session_token",
	);
	if (!signedToken) {
		throw new Error(
			"signUpAndGetHeaders: session_token cookie not found in set-cookie header",
		);
	}

	const body = (await response.json()) as {
		token: string;
		user: { id: string; email: string; name: string };
	};

	const headers = new Headers();
	headers.set("cookie", `better-auth.session_token=${signedToken}`);

	return {
		user: body.user,
		token: body.token,
		headers,
	};
};
