/**
 * @file Core DynamoDB table schemas provided by this adapter.
 *
 * These are hand-crafted table definitions for Better Auth's core tables
 * (user, session, account, verification) with DynamoDB-optimized GSI configurations.
 *
 * Use these schemas when:
 * - You want explicit control over table structure
 * - You're not using Better Auth plugins that require additional tables
 * - You prefer hand-crafted definitions over auto-generation
 *
 * For plugin support, use `generateTableSchemas()` from `./from-better-auth.ts` instead.
 */
import type { TableSchema } from "../dynamodb/types";
/**
 * Core table schemas for Better Auth with DynamoDB-optimized GSIs.
 *
 * Includes:
 * - user: email, username GSIs
 * - session: userId+createdAt, token+createdAt composite GSIs
 * - account: accountId, userId, providerId+accountId GSIs
 * - verification: identifier+createdAt composite GSI
 */
export declare const coreTableSchemas: TableSchema[];
/**
 * @deprecated Use `coreTableSchemas` instead. Will be removed in a future version.
 */
export declare const multiTableSchemas: TableSchema[];
//# sourceMappingURL=core-schemas.d.ts.map