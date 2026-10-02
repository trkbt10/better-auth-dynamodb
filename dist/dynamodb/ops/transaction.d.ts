/**
 * @file DynamoDB transaction helpers.
 *
 * Writes made through a transaction adapter are not sent one by one. The
 * transaction keeps one entry per item: the row as DynamoDB stored it when the
 * transaction first touched it (`base`) and the row after the buffered writes
 * (`current`). Reads inside the transaction are answered from that overlay, so
 * they see the transaction's own writes, and the commit sends exactly one
 * operation per item, which is what TransactWriteItems requires.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
type TransactionRow = Record<string, NativeAttributeValue>;
export type DynamoDBTransactionItem = {
    tableName: string;
    keyField: string;
    key: TransactionRow;
    /**
     * The stored row when the transaction first touched the item, or
     * `undefined` when the transaction created it.
     */
    base: TransactionRow | undefined;
    /**
     * The row after the buffered writes, or `null` when it is deleted.
     */
    current: TransactionRow | null;
    /**
     * Attributes of `base` the commit requires to be unchanged.
     */
    pinnedFields: string[];
    /**
     * Attributes the transaction assigned to a stored row. The commit writes
     * exactly these, each as a whole value.
     */
    assignedFields: string[];
    /**
     * Whether the transaction deleted a stored row and created it again: the
     * commit then replaces the row instead of updating attributes of it.
     */
    replaced: boolean;
};
export type DynamoDBTransactionState = {
    items: DynamoDBTransactionItem[];
};
/**
 * TransactWriteItems accepts up to 100 actions per request.
 */
export declare const TRANSACTION_ITEM_LIMIT = 100;
export declare const createTransactionState: () => DynamoDBTransactionState;
export declare const findTransactionItem: (state: DynamoDBTransactionState, target: {
    tableName: string;
    keyField: string;
    keyValue: unknown;
}) => DynamoDBTransactionItem | undefined;
export declare const countTransactionItems: (state: DynamoDBTransactionState, tableName: string) => number;
export declare const hasTransactionItems: (state: DynamoDBTransactionState, tableName: string) => boolean;
/**
 * Buffer the creation of a row. A row the transaction already holds cannot be
 * created again; a row it deleted earlier is replaced.
 */
export declare const bufferTransactionCreate: (state: DynamoDBTransactionState, props: {
    tableName: string;
    keyField: string;
    item: TransactionRow;
}) => void;
/**
 * Buffer the new image of a row the transaction read: `next` is the updated
 * row, or `null` to delete it. `row` is the image the write was computed from,
 * which is the stored row unless the transaction already holds the item.
 * `assignedFields` names the attributes an update assigned.
 */
export declare const bufferTransactionWrite: (state: DynamoDBTransactionState, props: {
    tableName: string;
    keyField: string;
    row: TransactionRow;
    next: TransactionRow | null;
    assignedFields?: string[] | undefined;
}) => DynamoDBTransactionItem;
/**
 * Require the given attributes of the stored row to be unchanged at commit.
 */
export declare const pinTransactionFields: (entry: DynamoDBTransactionItem, fields: string[]) => void;
/**
 * Replace the stored rows the transaction has written to with their buffered
 * images, and add the buffered rows that match.
 */
export declare const applyTransactionOverlay: <T extends TransactionRow>(state: DynamoDBTransactionState, props: {
    tableName: string;
    keyField: string;
    items: T[];
    matches: (item: TransactionRow) => boolean;
}) => T[];
export declare const executeTransaction: (props: {
    documentClient: DynamoDBDocumentClient;
    state: DynamoDBTransactionState;
}) => Promise<void>;
export {};
//# sourceMappingURL=transaction.d.ts.map