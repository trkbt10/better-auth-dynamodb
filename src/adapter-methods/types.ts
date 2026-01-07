/**
 * @file Shared types for adapter method builders.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { DynamoDBTransactionState } from "../dynamodb/operations/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";
import type { DynamoDBItem } from "../dynamodb/where/where-evaluator";

export type AdapterMethodContext = {
	documentClient: DynamoDBDocumentClient;
	fetchItems: (props: {
		model: string;
		where: DynamoDBWhere[] | undefined;
		limit?: number | undefined;
	}) => Promise<{
		items: DynamoDBItem[];
		requiresClientFilter: boolean;
	}>;
	fetchCount: (props: {
		model: string;
		where: DynamoDBWhere[] | undefined;
	}) => Promise<{
		count: number;
		requiresClientFilter: boolean;
		items: DynamoDBItem[];
	}>;
	applyClientFilter: (props: {
		items: DynamoDBItem[];
		where: DynamoDBWhere[] | undefined;
		model: string;
		requiresClientFilter: boolean;
	}) => DynamoDBItem[];
	resolveScanLimit: (props: {
		limit: number;
		offset: number;
		sortByDefined: boolean;
		requiresClientFilter: boolean;
	}) => number | undefined;
	transactionState?: DynamoDBTransactionState | undefined;
	getFieldName: (args: { model: string; field: string }) => string;
	resolveModelTableName: (model: string) => string;
	getPrimaryKeyName: (model: string) => string;
	mapWhereFilters: (where: Where[] | undefined) => DynamoDBWhere[] | undefined;
};
