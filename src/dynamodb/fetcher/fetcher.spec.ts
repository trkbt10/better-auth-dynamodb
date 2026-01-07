/**
 * @file Tests for DynamoDB adapter fetcher.
 */
import type { DynamoDBWhere } from "../types";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClientStub } from "../../../spec/dynamodb-document-client";
import { resolveAdapterConfig } from "../../adapter-config";
import { createAdapterFetcher } from "./fetcher";

describe("createAdapterFetcher", () => {
	const getFieldName = (props: { model: string; field: string }) => props.field;
	const getDefaultModelName = (model: string) => model;

	test("exposes fetchers and client filter", async () => {
		const { documentClient } = createDocumentClientStub({
			respond: async () => ({}),
		});
		const adapterConfig = resolveAdapterConfig({
			documentClient,
			tableNamePrefix: "auth_",
		});
		const fetcher = createAdapterFetcher({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});

		const items = fetcher.applyClientFilter({
			items: [{ id: "1" }],
			where: undefined,
			model: "user",
			requiresClientFilter: false,
		});

		expect(items).toEqual([{ id: "1" }]);
	});

	test("fetchItems uses query for primary key", async () => {
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
		const fetcher = createAdapterFetcher({
			documentClient,
			adapterConfig,
			getFieldName,
			getDefaultModelName,
		});

		const where: DynamoDBWhere[] = [
			{ field: "id", operator: "eq", value: "user-1" },
		];
		const result = await fetcher.fetchItems({
			model: "user",
			where,
			limit: 1,
		});

		expect(result.items).toEqual([{ id: "user-1" }]);
		expect(sendCalls[0]).toBeInstanceOf(QueryCommand);
	});
});
