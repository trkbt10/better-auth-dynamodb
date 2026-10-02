/**
 * @file Normalize Better Auth where clauses for planning.
 */
import type { Where } from "@better-auth/core/db/adapter";
import type { NormalizedWhere } from "../query-plan";
import type { DynamoDBWhere } from "../../dynamodb/types";
export declare const toDynamoWhere: (where: NormalizedWhere[]) => DynamoDBWhere[];
export declare const normalizeWhere: (props: {
    where?: Where[] | undefined;
}) => NormalizedWhere[];
