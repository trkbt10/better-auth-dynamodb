/**
 * @file Rate-limit identity across the adapter factory, DynamoDB, and transactions.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import { dynamodbAdapter } from "../src/adapter";
import { createIndexResolversFromSchemas, generateTableSchemas } from "../src/table-schemas";
import { createLocalEnvironment, localClients } from "./dynamodb-local-environment";

const options: BetterAuthOptions = {
  rateLimit: {
    storage: "database",
    modelName: "requestCounter",
    fields: { key: "bucket", count: "hits", lastRequest: "lastSeen" },
  },
};
const prefix = "rate_limit_identity_";
const environment = createLocalEnvironment({ tableNamePrefix: prefix, options });
const resolvers = createIndexResolversFromSchemas(generateTableSchemas(options));

beforeAll(environment.setUp);
afterAll(environment.tearDown);

for (const usePlural of [false, true]) {
  describe(`custom database counter names (usePlural: ${usePlural})`, () => {
    const adapter = dynamodbAdapter({
      documentClient: localClients.documentClient,
      tableNamePrefix: prefix,
      scanMaxPages: 25,
      usePlural,
      transaction: true,
      ...resolvers,
    })(options);
    const model = "rateLimit";
    const bucket = `203.0.113.25|/${usePlural}`;
    const where = [{ field: "key", value: bucket }];

    test("one concurrent create wins and key lookups preserve guards and projections", async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
        adapter.create({ model, data: { key: bucket, count: 1, lastRequest: Date.now() } }),
      ));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(11);
      const rows = await adapter.findMany({ model, where });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ key: bucket, count: 1, id: expect.stringMatching(/^rate-limit:/) });
      expect(await adapter.count({ model, where })).toBe(1);
      expect(await adapter.findOne({ model, where, select: ["count"] })).toEqual({ count: 1 });
      expect(await adapter.incrementOne({ model, where: [...where, { field: "count", value: 2, operator: "lt" }], increment: { count: 1 } }))
        .toMatchObject({ count: 2 });
      expect(await adapter.incrementOne({ model, where: [...where, { field: "count", value: 2, operator: "lt" }], increment: { count: 1 } })).toBeNull();
      expect(await adapter.findOne({ model, where: [...where, { field: "id", value: "wrong-id" }] })).toBeNull();
    });

    test("identity fields cannot be changed through any mutation method", async () => {
      await expect(adapter.update({ model, where, update: { key: "other" } })).rejects.toThrow("immutable");
      await expect(adapter.updateMany({ model, where, update: { key: "other" } })).rejects.toThrow("immutable");
      await expect(adapter.incrementOne({ model, where, increment: {}, set: { key: "other" } })).rejects.toThrow("immutable");
      await expect(adapter.incrementOne({ model, where, increment: { id: 1 } })).rejects.toThrow("immutable");
      expect(await adapter.findOne({ model, where })).toMatchObject({ key: bucket, count: 2 });
    });

    test("transactions read their own deterministic creates and guarded increments", async () => {
      const transactionKey = `${bucket}/transaction`;
      const transactionWhere = [{ field: "key", value: transactionKey }];
      await adapter.transaction(async (tx) => {
        await tx.create({ model, data: { key: transactionKey, count: 1, lastRequest: Date.now() } });
        expect(await tx.findOne({ model, where: transactionWhere })).toMatchObject({ count: 1 });
        expect(await tx.incrementOne({ model, where: transactionWhere, increment: { count: 1 } })).toMatchObject({ count: 2 });
        expect(await tx.count({ model, where: transactionWhere })).toBe(1);
      });
      expect(await adapter.findOne({ model, where: transactionWhere })).toMatchObject({ count: 2 });
      await expect(adapter.transaction(async (tx) => {
        await tx.create({ model, data: { key: transactionKey, count: 99, lastRequest: Date.now() } });
      })).rejects.toThrow();
      expect(await adapter.findOne({ model, where: transactionWhere })).toMatchObject({ count: 2 });
    });

    test("normal updates, delete, consume, and recreate stay addressable by key", async () => {
      expect(await adapter.updateMany({ model, where, update: { count: 3 } })).toBe(1);
      expect(await adapter.update({ model, where, update: { count: 4 } })).toMatchObject({ count: 4 });
      expect(await adapter.consumeOne({ model, where })).toMatchObject({ count: 4 });
      expect(await adapter.findOne({ model, where })).toBeNull();
      await adapter.create({ model, data: { key: bucket, count: 1, lastRequest: Date.now() } });
      await adapter.delete({ model, where });
      expect(await adapter.count({ model, where })).toBe(0);
      await adapter.create({ model, data: { key: bucket, count: 1, lastRequest: Date.now() } });
      expect(await adapter.deleteMany({ model, where })).toBe(1);
    });
  });
}
