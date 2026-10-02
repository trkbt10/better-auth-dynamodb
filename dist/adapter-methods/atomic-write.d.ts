import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { Where } from "@better-auth/core/db/adapter";
import type { ResolvedDynamoDBAdapterConfig } from "../adapter";
import { type DynamoDBItem } from "../adapter/executor/where-evaluator";
import type { AtomicCondition } from "../dynamodb/expressions/build-atomic-condition";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";
import type { ConditionalWriteResult } from "../dynamodb/ops/conditional-write";
import { type DynamoDBTransactionState } from "../dynamodb/ops/transaction";
import type { DynamoDBWhere } from "../dynamodb/types";
import type { AdapterClientContainer } from "./client-container";
/**
 * How many times an atomic method writes to one row. A write is repeated only
 * when its condition failed although a strongly consistent read shows the row
 * still matching, i.e. another writer changed it in between. The bound mirrors
 * the compare-and-swap budget of Better Auth's own atomic fallback
 * (`MAX_ATTEMPTS` in `@better-auth/core/db/adapter`), which also raises an
 * error instead of reporting "no row matched" when it runs out.
 */
export declare const MAX_ATOMIC_WRITE_ATTEMPTS = 5;
export type AtomicMethodOptions = {
    adapterConfig: ResolvedDynamoDBAdapterConfig;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
    getDefaultModelName: (model: string) => string;
    transactionState?: DynamoDBTransactionState | undefined;
};
export type AtomicTarget = {
    key: Record<string, NativeAttributeValue>;
    snapshot: DynamoDBItem;
};
export type PinnedPrimaryKey = {
    pinned: true;
    value: NativeAttributeValue | null | undefined;
} | {
    pinned: false;
};
export declare const toAtomicWhere: (where: Where[]) => DynamoDBWhere[];
/**
 * Resolve the primary key value when the where clause selects one row by its
 * primary key (an AND-connected equality on the key attribute).
 */
export declare const resolvePinnedPrimaryKey: (props: {
    model: string;
    where: Where[];
    primaryKeyName: string;
    getFieldName: (args: {
        model: string;
        field: string;
    }) => string;
}) => PinnedPrimaryKey;
export declare const buildConditionInput: (condition: AtomicCondition, extra?: {
    conditions: string[];
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
}) => {
    ConditionExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues?: Record<string, NativeAttributeValue>;
};
export declare const createContentionError: (method: string) => DynamoDBAdapterError;
/**
 * Create the reads an atomic method resolves its target row with.
 *
 * - `readMatchingRow` reads one row by primary key, strongly consistently,
 *   and checks the where clause against it in memory.
 * - `findCandidate` goes through the query planner, exactly like update /
 *   delete. Its result can be stale.
 * - `resolveTarget` picks between the two: a where clause that pins the
 *   primary key needs no planner.
 *
 * Inside a transaction all of them see the transaction's own writes.
 */
export declare const createAtomicRowReader: (client: AdapterClientContainer, options: AtomicMethodOptions) => {
    readMatchingRow: (props: {
        model: string;
        where: Where[];
        keyValue: NativeAttributeValue | null | undefined;
    }) => Promise<AtomicTarget | null>;
    findCandidate: (props: {
        model: string;
        where: Where[];
        excludedKeyValues: string[];
    }) => Promise<AtomicTarget | null>;
    resolvePinned: (props: {
        model: string;
        where: Where[];
    }) => PinnedPrimaryKey;
    resolveTarget: (props: {
        model: string;
        where: Where[];
    }) => Promise<AtomicTarget | null>;
};
export type AtomicRowReader = ReturnType<typeof createAtomicRowReader>;
/**
 * Apply a conditional write to a single row matching the where clause.
 *
 * Returns the row the write reports, or `null` when no row matches. A
 * candidate that turns out to be gone or changed is left out of the next
 * lookup, so a stale index entry cannot be picked twice and another matching
 * row is still reached.
 */
export declare const settleAtomicWrite: (props: {
    method: string;
    reader: AtomicRowReader;
    model: string;
    where: Where[];
    write: (target: AtomicTarget) => Promise<ConditionalWriteResult>;
}) => Promise<DynamoDBItem | null>;
