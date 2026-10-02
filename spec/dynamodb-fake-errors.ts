/**
 * @file Errors raised by the in-memory DynamoDB fake.
 *
 * The adapter tells DynamoDB failures apart by `error.name` (for example
 * `ConditionalCheckFailedException`), so the fake raises errors whose `name`
 * matches the service exception the real engine returns. Constructs the fake
 * does not emulate raise `FakeDynamoDBUnsupportedError` instead of being
 * ignored: a fake that silently drops part of a request makes a passing test
 * meaningless.
 */

export type CancellationReason = {
	Code: string;
	Message?: string | undefined;
};

/**
 * An error carrying the `name` of the DynamoDB service exception it stands for.
 */
export class FakeDynamoDBError extends Error {
	readonly CancellationReasons: CancellationReason[] | undefined;

	constructor(props: {
		name: string;
		message: string;
		cancellationReasons?: CancellationReason[] | undefined;
	}) {
		super(props.message);
		this.name = props.name;
		this.CancellationReasons = props.cancellationReasons;
	}
}

/**
 * Raised for a request (command, parameter, or expression construct) that the
 * fake does not emulate. It is never a DynamoDB exception name, so no adapter
 * code path can mistake it for a service response.
 */
export class FakeDynamoDBUnsupportedError extends Error {
	constructor(message: string) {
		super(`In-memory DynamoDB fake does not support: ${message}`);
		this.name = "FakeDynamoDBUnsupportedError";
	}
}

export const validationError = (message: string): FakeDynamoDBError =>
	new FakeDynamoDBError({ name: "ValidationException", message });

export const conditionalCheckFailed = (): FakeDynamoDBError =>
	new FakeDynamoDBError({
		name: "ConditionalCheckFailedException",
		message: "The conditional request failed",
	});

export const resourceNotFound = (): FakeDynamoDBError =>
	new FakeDynamoDBError({
		name: "ResourceNotFoundException",
		message: "Cannot do operations on a non-existent table",
	});

export const transactionCanceled = (
	reasons: CancellationReason[],
): FakeDynamoDBError =>
	new FakeDynamoDBError({
		name: "TransactionCanceledException",
		message: `Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons
			.map((reason) => reason.Code)
			.join(", ")}]`,
		cancellationReasons: reasons,
	});

export const unsupported = (message: string): FakeDynamoDBUnsupportedError =>
	new FakeDynamoDBUnsupportedError(message);
