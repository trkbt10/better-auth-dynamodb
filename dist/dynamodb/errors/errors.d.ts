/**
 * @file DynamoDB adapter error definitions.
 */
export type DynamoDBAdapterErrorCode = "MISSING_CLIENT" | "MISSING_TABLE_RESOLVER" | "MISSING_PRIMARY_KEY" | "MISSING_WHERE_INPUT" | "MISSING_QUERY_PLAN_INPUT" | "MISSING_JOIN_PLAN_INPUT" | "MISSING_STRATEGY_INPUT" | "MISSING_JOIN_STRATEGY_INPUT" | "MISSING_JOIN_EXECUTION_INPUT" | "MISSING_EXECUTOR_INPUT" | "MISSING_INDEX_RESOLVER" | "MISSING_KEY_CONDITION" | "MISSING_SCAN_LIMIT" | "SCAN_PAGE_LIMIT" | "BATCH_GET_UNPROCESSED" | "TRANSACTION_LIMIT" | "UNSUPPORTED_OPERATOR" | "UNSUPPORTED_JOIN" | "UNSUPPORTED_TRANSACTION" | "INVALID_UPDATE";
/**
 * Adapter error with a stable error code.
 */
export declare class DynamoDBAdapterError extends Error {
    code: DynamoDBAdapterErrorCode;
    constructor(code: DynamoDBAdapterErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map