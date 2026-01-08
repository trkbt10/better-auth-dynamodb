/**
 * @file Tests for DynamoDB adapter behavior.
 */
import type { Where } from "@better-auth/core/db/adapter";
import {
	PutCommand,
	QueryCommand,
	ScanCommand,
	TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../spec/dynamodb-document-client";
import { dynamodbAdapter } from "./adapter";

describe("dynamodbAdapter", () => {
	const captureAsyncError = async (fn: () => Promise<void>): Promise<unknown> => {
		try {
			await fn();
		} catch (error) {
			return error;
		}
		return undefined;
	};

	test("commits transaction operations", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			transaction: true,
		});
		const adapter = adapterFactory({});

		const result = await adapter.transaction(async (tx) => {
			await tx.create({
				model: "user",
				data: { email: "a@example.com" },
			});
			return "ok";
		});

		expect(result).toBe("ok");
		expect(sendCalls.length).toBe(1);
		expect(sendCalls[0]).toBeInstanceOf(TransactWriteCommand);
	});

	test("creates items with PutCommand", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
		});
		const adapter = adapterFactory({});

		await adapter.create({
			model: "user",
			data: {
				name: "user",
				email: "a@example.com",
				emailVerified: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});

		expect(sendCalls[0]).toBeInstanceOf(PutCommand);
	});

	test("does not execute transaction on error", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			transaction: true,
		});
		const adapter = adapterFactory({});
		const error = await captureAsyncError(async () => {
			await adapter.transaction(async (tx) => {
				await tx.create({
					model: "user",
					data: { email: "a@example.com" },
				});
				throw new Error("boom");
			});
		});

		expect(error).toBeInstanceOf(Error);
		expect(sendCalls.length).toBe(0);
	});

	test("uses query for primary key lookups", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "user-1" }] };
				}
				return {};
			},
		});

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
		});
		const adapter = adapterFactory({});
		const where: Where[] = [
			{ field: "id", operator: "eq", value: "user-1" },
		];

		const result = await adapter.findOne({ model: "user", where });

		expect(result).toEqual({ id: "user-1" });
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});

	test("uses scan for non-key lookups", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command) => {
				if (command instanceof ScanCommand) {
					return { Items: [{ id: "user-1", email: "a@example.com" }] };
				}
				return {};
			},
		});

		const adapterFactory = dynamodbAdapter({
			documentClient,
			tableNamePrefix: "auth_",
			scanMaxPages: 1,
		});
		const adapter = adapterFactory({});
		const where: Where[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];

		const result = await adapter.findOne({ model: "user", where });

		expect(result).toEqual({ id: "user-1", email: "a@example.com" });
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});
});
