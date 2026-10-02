/**
 * @file Give database rate-limit keys one conditional-create primary key.
 */
import { createHash } from "node:crypto";
import type { BetterAuthOptions } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import { DynamoDBAdapterError } from "../dynamodb/errors/errors";

export const createRateLimitKeyMapping = (props: {
  options: BetterAuthOptions;
  getDefaultModelName: (model: string) => string;
  getFieldName: (args: { model: string; field: string }) => string;
}) => {
  const applies = (model: string): boolean => {
    if (props.options.rateLimit?.storage !== "database") {
      return false;
    }
    return props.getDefaultModelName(model) === "rateLimit";
  };
  // A hash keeps arbitrarily long IP/path keys within DynamoDB's PK limit.
  const toId = (key: string): string =>
    `rate-limit:${createHash("sha256").update(key).digest("hex")}`;

  const create = <T extends { model: string; data: Record<string, unknown> }>(input: T): T => {
    if (!applies(input.model)) {
      return input;
    }
    const keyField = props.getFieldName({ model: input.model, field: "key" });
    const key = input.data[keyField];
    if (typeof key !== "string" || key.length === 0) {
      throw new DynamoDBAdapterError("INVALID_RATE_LIMIT_KEY", "A database rate-limit row requires a non-empty string key.");
    }
    const idField = props.getFieldName({ model: input.model, field: "id" });
    return { ...input, data: { ...input.data, [idField]: toId(key) } };
  };

  const where = <T extends { model: string; where?: Where[] | undefined }>(input: T): T => {
    if (!applies(input.model) || !input.where) {
      return input;
    }
    // Deriving a PK from one branch of an OR would exclude valid other rows.
    if (input.where.some((entry) => entry.connector === "OR")) {
      return input;
    }
    const keyField = props.getFieldName({ model: input.model, field: "key" });
    const key = input.where.find((entry) =>
      props.getFieldName({ model: input.model, field: entry.field }) === keyField &&
      (entry.operator ?? "eq") === "eq" && entry.mode !== "insensitive" &&
      typeof entry.value === "string",
    );
    if (!key || typeof key.value !== "string") {
      return input;
    }
    return {
      ...input,
      where: [
        ...input.where,
        { field: props.getFieldName({ model: input.model, field: "id" }), value: toId(key.value), connector: "AND" },
      ],
    };
  };

  const assertMutable = (model: string, assignments: unknown): void => {
    if (!applies(model)) {
      return;
    }
    if (assignments === null || typeof assignments !== "object" || Array.isArray(assignments)) {
      throw new DynamoDBAdapterError("INVALID_UPDATE", "Database rate-limit assignments must be an object.");
    }
    const identityFields = ["key", "id"].map((field) => props.getFieldName({ model, field }));
    if (identityFields.some((field) => Object.hasOwn(assignments, field))) {
      throw new DynamoDBAdapterError("INVALID_UPDATE", "Database rate-limit key and id are immutable; delete the row and create a new key instead.");
    }
  };

  return { create, where, assertMutable, applies };
};
