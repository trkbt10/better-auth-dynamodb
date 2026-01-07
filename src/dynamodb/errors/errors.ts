/**
 * @file DynamoDB adapter error definitions.
 */

export type DynamoDBAdapterErrorCode =
	| "MISSING_CLIENT"
	| "MISSING_TABLE_RESOLVER"
	| "MISSING_PRIMARY_KEY"
	| "TRANSACTION_LIMIT"
	| "UNSUPPORTED_OPERATOR"
	| "UNSUPPORTED_JOIN"
	| "UNSUPPORTED_TRANSACTION"
	| "INVALID_UPDATE";

/**
 * Adapter error with a stable error code.
 */
export class DynamoDBAdapterError extends Error {
	constructor(public code: DynamoDBAdapterErrorCode, message: string) {
		super(message);
		this.name = "DynamoDBAdapterError";
	}
}
