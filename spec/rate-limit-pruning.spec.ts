/**
 * @file Expiration cleanup must not delete counters reset after its read.
 */
import { DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createInterleavingClient, createLocalEnvironment, localClients } from "./dynamodb-local-environment";

const environment = createLocalEnvironment({
  tableNamePrefix: "rate_limit_pruning_",
  options: { rateLimit: { storage: "database" } },
});
const adapter = environment.createAdapter({ transaction: true });
const model = "rateLimit";

beforeAll(environment.setUp);
afterAll(environment.tearDown);

test("a cleanup read followed by a concurrent reset does not delete the active counter", async () => {
  const key = "203.0.113.1|/prune";
  const row = await adapter.create({ model, data: { key, count: 4, lastRequest: 1 } });
  const interfering = createInterleavingClient({
    shouldInterfere: (command): command is DeleteCommand => command instanceof DeleteCommand,
    interfere: async () => {
      await localClients.documentClient.send(new UpdateCommand({
        TableName: environment.tableName(model),
        Key: { id: row.id },
        UpdateExpression: "SET #time = :time, #count = :count",
        ExpressionAttributeNames: { "#time": "lastRequest", "#count": "count" },
        ExpressionAttributeValues: { ":time": 1000, ":count": 1 },
      }));
    },
  });
  const cleanup = environment.createAdapter({ documentClient: interfering.documentClient });
  expect(await cleanup.deleteMany({ model, where: [{ field: "lastRequest", operator: "lt", value: 100 }] })).toBe(0);
  expect(interfering.interferences()).toBe(1);
  expect(await adapter.findOne({ model, where: [{ field: "key", value: key }] })).toMatchObject({ count: 1, lastRequest: 1000 });
});

test("transactional cleanup cannot commit over a concurrent reset", async () => {
  const key = "203.0.113.2|/prune";
  await adapter.create({ model, data: { key, count: 4, lastRequest: 1 } });
  await expect(adapter.transaction(async (tx) => {
    expect(await tx.deleteMany({ model, where: [{ field: "lastRequest", operator: "lt", value: 100 }] })).toBe(1);
    await adapter.incrementOne({ model, where: [{ field: "key", value: key }], increment: {}, set: { count: 1, lastRequest: 1000 } });
  })).rejects.toThrow();
  expect(await adapter.findOne({ model, where: [{ field: "key", value: key }] })).toMatchObject({ count: 1, lastRequest: 1000 });
});
