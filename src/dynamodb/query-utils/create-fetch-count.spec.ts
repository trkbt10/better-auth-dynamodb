/**
 * @file Tests for fetch count builder.
 */
import type { DynamoDBWhere } from "../types";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { resolveAdapterConfig } from "../../adapter-config";
import { createFetchCount } from "./create-fetch-count";

describe("createFetchCount", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;
	const getFieldAttributes = (props: { model: string; field: string }) => ({
		index: props.field === "email",
	});

	test("queries count by primary key", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof QueryCommand) {
					return { Count: 2 };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
		});
		const fetchCount = createFetchCount({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes,
		});

		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "user-1" },
		];
		const result = await fetchCount({ model: "user", where });

		expect(result.count).toBe(2);
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});

	test("scans count by non-key where", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof ScanCommand) {
					return { Count: 3 };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
		});
		const fetchCount = createFetchCount({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes: () => ({ index: false }),
		});

		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = await fetchCount({ model: "user", where });

		expect(result.count).toBe(3);
		expect(sendCalls[0]).toBeInstanceOf(ScanCommand);
	});

	test("queries count by indexed field using GSI", async () => {
		const { documentClient, sendCalls } = createDocumentClientStub({
			respond: async (command: unknown) => {
				if (command instanceof QueryCommand) {
					return { Count: 5 };
				}
				return {};
			},
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
			indexNameResolver: ({ model, field }) => `${model}_${field}_index`,
		});
		const fetchCount = createFetchCount({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
			getFieldAttributes,
		});

		const where: DynamoDBWhere[] = [
			{ field: "email", operator: "eq", value: "a@example.com" },
		];
		const result = await fetchCount({ model: "user", where });

		const command = sendCalls[0] as QueryCommand;
		expect(result.count).toBe(5);
		expect(command).toBeInstanceOf(QueryCommand);
		expect(command.input.IndexName).toBe("user_email_index");
	});
});
