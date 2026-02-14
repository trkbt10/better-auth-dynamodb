/**
 * @file Default composite index definitions for DynamoDB GSIs.
 *
 * These composite indexes are derived from Better Auth's internal access patterns
 * (internal-adapter.mjs) to optimize query performance. They are applied by default
 * when generating table schemas.
 */
import type { CompositeIndex } from "./types";

/**
 * Default composite indexes based on Better Auth's query patterns.
 *
 * These optimize common access patterns:
 * - account: lookup by providerId + accountId (OAuth linking)
 * - session: lookup by userId/token + createdAt (session management)
 * - verification: lookup by identifier + createdAt (verification codes)
 */
export const defaultCompositeIndexes: Record<string, CompositeIndex[]> = {
	account: [{ partitionKey: "providerId", sortKey: "accountId" }],
	session: [
		{ partitionKey: "userId", sortKey: "createdAt" },
		{ partitionKey: "token", sortKey: "createdAt" },
	],
	verification: [{ partitionKey: "identifier", sortKey: "createdAt" }],
};
