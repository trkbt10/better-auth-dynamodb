/**
 * @file Tests for fetch items builder.
 */
import type { DynamoDBWhere } from "../types";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { resolveAdapterConfig } from "../../adapter-config";
import { createFetchItems } from "./create-fetch-items";

describe("createFetchItems", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;
	const getFieldAttributes = (props: { model: string; field: string }) => ({
		index: props.field === "email",
	});

	test("queries by primary key", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "user-1" }] };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
		});
		const fetchItems = createFetchItems({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes,
		});

		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "user-1" },
		];
		const result = await fetchItems({
			model: "user",
			where,
			limit: 1,
		});

		expect(result.items).toEqual([{ id: "user-1" }]);
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});

	test("scans by non-key where", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof ScanCommand) {
					return { Items: [{ id: "user-1", email: "a@example.com" }] };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
		});
		const fetchItems = createFetchItems({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes: () => ({ index: false }),
		});

		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = await fetchItems({
			model: "user",
			where,
			limit: 1,
		});

		expect(result.items).toEqual([{ id: "user-1", email: "a@example.com" }]);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});

	test("queries by indexed field using GSI", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof QueryCommand) {
					return { Items: [{ id: "user-2", email: "b@example.com" }] };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
			indexNameResolver: ({ model, field }) => `${model}_${field}_index`,
		});
		const fetchItems = createFetchItems({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes,
		});

		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "b@example.com" },
		];
		const result = await fetchItems({
			model: "user",
			where,
			limit: 1,
		});

		const command = sendCalls[0] as QueryCommand;
		expect(result.items).toEqual([{ id: "user-2", email: "b@example.com" }]);
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("user_email_index");
	});
});
