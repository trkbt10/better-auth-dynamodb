/**
 * @file Shared types for adapter method builders.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { AdapterFetcher } from "../dynamodb/fetcher/fetcher";
import type { DynamoDBTransactionState } from "../dynamodb/operations/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";

export type AdapterMethodContext = {
	documentClient: DynamoDBDocumentClient;
	fetcher: AdapterFetcher;
	transactionState?: DynamoDBTransactionState | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	resolveModelTableName: (model: string) => string;
	getPrimaryKeyName: (model: string) => string;
	mapWhereFilters: (where: Where[] | undefined) => DynamoDBWhere[] | undefined;
};
