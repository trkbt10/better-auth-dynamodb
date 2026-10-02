/**
 * @file Database rate-limit identity mapping and immutable-key guards.
 */
import type { BetterAuthOptions } from "@better-auth/core";
import type { Where } from "@better-auth/core/db/adapter";
import { createRateLimitKeyMapping } from "./rate-limit-key-mapping";

const createMapping = (options: BetterAuthOptions = { rateLimit: { storage: "database" } }) =>
  createRateLimitKeyMapping({
    options,
    getDefaultModelName: (model) => {
      if (model === "requestCounters") {
        return "rateLimit";
      }
      return model;
    },
    getFieldName: ({ field }) => {
      if (field === "id") {
        return "pk";
      }
      if (field === "key") {
        return "bucket";
      }
      return field;
    },
  });

test("concurrent-create identity depends on the key, including custom model and field names", () => {
  const mapping = createMapping();
  const first = { model: "requestCounters", data: { pk: "random-1", bucket: "203.0.113.1|/ok", count: 1 } };
  const second = { ...first, data: { ...first.data, pk: "random-2" } };
  const created = mapping.create(first);
  expect(created.data.pk).toBe(mapping.create(second).data.pk);
  expect(first.data.pk).toBe("random-1");
  expect(created.data).toMatchObject({ bucket: first.data.bucket, count: 1 });
  expect(created.data.pk).not.toBe(mapping.create({ ...first, data: { ...first.data, bucket: "other" } }).data.pk);
  const selected = mapping.where({ model: first.model, where: [{ field: "key", value: first.data.bucket }] });
  expect(selected.where).toContainEqual({ field: "pk", value: created.data.pk, connector: "AND" });
});

test("long and Unicode keys produce bounded identities without truncating the bucket", () => {
  const mapping = createMapping();
  const bucket = "日本語/😀".repeat(1000);
  const row = mapping.create({ model: "rateLimit", data: { bucket } });
  expect(row.data).toMatchObject({ bucket, pk: expect.stringMatching(/^rate-limit:[a-f0-9]{64}$/) });
});

test.each([undefined, null, "", 42, [], {}])("rejects an invalid counter key: %j", (bucket) => {
  expect(() => createMapping().create({ model: "rateLimit", data: { bucket } }))
    .toThrow("requires a non-empty string key");
});

test.each([{}, { rateLimit: { storage: "memory" } } satisfies BetterAuthOptions])("only applies to explicitly configured database counters", (options) => {
  const mapping = createMapping(options);
  const input = { model: "rateLimit", data: { pk: "explicit-id", bucket: "key" } };
  const query = { model: "rateLimit", where: [{ field: "bucket", value: "key" }] };
  expect(mapping.create(input)).toBe(input);
  expect(mapping.where(query)).toBe(query);
  expect(() => mapping.assertMutable("rateLimit", { bucket: "changed" })).not.toThrow();
});

test("leaves other models unchanged", () => {
  const mapping = createMapping();
  const input = { model: "user", data: { pk: "explicit-id", bucket: "key" } };
  expect(mapping.create(input)).toBe(input);
  expect(() => mapping.assertMutable("user", { bucket: "changed" })).not.toThrow();
});

const unpinnedCases: { model: string; where?: Where[] | undefined }[] = [
  { model: "rateLimit" },
  { model: "rateLimit", where: [{ field: "bucket", value: "key", connector: "OR" }] },
  { model: "rateLimit", where: [{ field: "bucket", value: "key", mode: "insensitive" }] },
  { model: "rateLimit", where: [{ field: "bucket", value: "key", operator: "ne" }] },
  { model: "rateLimit", where: [{ field: "bucket", value: ["key"], operator: "in" }] },
  { model: "rateLimit", where: [{ field: "count", value: 2 }] },
  { model: "user", where: [{ field: "bucket", value: "key" }] },
];

test.each(unpinnedCases)("does not narrow non-equality or OR selectors: %j", (input) => {
  expect(createMapping().where(input)).toBe(input);
});

test.each([{ pk: "other" }, { bucket: "other" }, null, [], "key"])("rejects identity mutation or malformed assignments: %j", (assignments) => {
  expect(() => createMapping().assertMutable("rateLimit", assignments)).toThrow();
});

test("allows numeric counter and timestamp assignments", () => {
  expect(() => createMapping().assertMutable("rateLimit", { count: 1, lastRequest: 1000 })).not.toThrow();
});
