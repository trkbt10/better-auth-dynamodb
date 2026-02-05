/**
 * @file Transaction buffer search for read-your-writes support.
 *
 * During a transaction, write operations (create/update/delete) are buffered
 * in DynamoDBTransactionState and committed atomically at the end. This module
 * enables read methods to search the buffer so that items created earlier in
 * the same transaction can be found without querying DynamoDB.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { DynamoDBTransactionState } from "../dynamodb/ops/transaction";
export type TransactionBufferSearchResult = {
    found: true;
    item: Record<string, NativeAttributeValue>;
} | {
    found: false;
};
/**
 * Search buffered PUT operations for an item matching the given table and
 * where clause.  Returns the most recently buffered match (last wins).
 */
export declare const searchTransactionBuffer: (props: {
    transactionState: DynamoDBTransactionState;
    tableName: string;
    where: Where[];
}) => TransactionBufferSearchResult;
//# sourceMappingURL=transaction-buffer-search.d.ts.map