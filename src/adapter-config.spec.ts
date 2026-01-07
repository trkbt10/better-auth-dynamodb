/**
 * @file Tests for DynamoDB adapter config resolution.
 */
import { resolveAdapterConfig } from "./adapter-config";
import { createDocumentClientStub } from "../spec/dynamodb-document-client";

describe("resolveAdapterConfig", () => {
	test("fills defaults when omitted", () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const resolved = resolveAdapterConfig({ documentClient });

		expect(resolved.documentClient).toBe(documentClient);
		expect(resolved.usePlural).toBe(false);
		expect(resolved.transaction).toBe(false);
		expect(resolved.debugLogs).toBeUndefined();
	});

	test("keeps provided config values", () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const resolver = (modelName: string) => `prefix_${modelName}`;
		const resolved = resolveAdapterConfig({
			documentClient,
			debugLogs: true,
			usePlural: true,
			tableNamePrefix: "auth_",
			tableNameResolver: resolver,
			transaction: false,
		});

		expect(resolved.debugLogs).toBe(true);
		expect(resolved.usePlural).toBe(true);
		expect(resolved.tableNamePrefix).toBe("auth_");
		expect(resolved.tableNameResolver).toBe(resolver);
	});
});
