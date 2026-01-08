/**
 * @file DynamoDB transaction helpers.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type DynamoDBTransactionOperation = {
    kind: "put";
    tableName: string;
    item: Record<string, NativeAttributeValue>;
} | {
    kind: "update";
    tableName: string;
    key: Record<string, NativeAttributeValue>;
    updateExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
} | {
    kind: "delete";
    tableName: string;
    key: Record<string, NativeAttributeValue>;
};
export type DynamoDBTransactionState = {
    operations: DynamoDBTransactionOperation[];
};
export declare const createTransactionState: () => DynamoDBTransactionState;
export declare const addTransactionOperation: (state: DynamoDBTransactionState, operation: DynamoDBTransactionOperation) => void;
export declare const executeTransaction: (props: {
    documentClient: DynamoDBDocumentClient;
    state: DynamoDBTransactionState;
}) => Promise<void>;
//# sourceMappingURL=transaction.d.ts.map