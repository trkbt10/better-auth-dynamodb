/**
 * @file Wait for the explicitly configured DynamoDB Local endpoint in CI.
 */
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { setTimeout } from "node:timers/promises";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
};

const client = new DynamoDBClient({
  endpoint: requiredEnv("DYNAMODB_ENDPOINT"),
  region: requiredEnv("AWS_REGION"),
  credentials: {
    accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
  },
  maxAttempts: 1,
});

const waitForDynamoDB = async (): Promise<void> => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await client.send(new ListTablesCommand({ Limit: 1 })).then(() => true, () => false);
    if (ready) {
      return;
    }
    await setTimeout(1000);
  }
  throw new Error("DynamoDB Local did not become ready within 60 attempts.");
};

try {
  await waitForDynamoDB();
} finally {
  client.destroy();
}
