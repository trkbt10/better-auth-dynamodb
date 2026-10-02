/**
 * @file Regression for simultaneous first requests against a database rate limiter.
 */
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { NO_FAULTS } from "./chaos-cluster";
import { createChaosEnvironment } from "./chaos-harness";

test("a concurrent first burst respects the database rate limit", async () => {
  const max = 4;
  const options: BetterAuthOptions = {
    secret: "test-secret-at-least-32-characters-long!!",
    baseURL: "http://localhost:3000",
    rateLimit: { enabled: true, storage: "database", window: 600, max },
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
  };
  const environment = createChaosEnvironment({
    seed: 42,
    profile: { name: "cold start interleaving", faults: NO_FAULTS },
    options,
  });
  const auth = betterAuth({ ...options, database: environment.createDatabase() });
  const request = async (): Promise<number> => {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/ok", {
      headers: { "x-forwarded-for": "203.0.113.50" },
    }));
    return response.status;
  };
  const results = await environment.cluster.run(Array.from({ length: 20 }, () => request));
  const statuses = results.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });
  const admitted = statuses.filter((status) => status === 200).length;
  expect(admitted, JSON.stringify({ statuses, counters: environment.cluster.store.get(environment.tableName("rateLimit")) }))
    .toBe(max);
  expect(statuses.filter((status) => status === 429)).toHaveLength(20 - max);
  expect(environment.cluster.store.get(environment.tableName("rateLimit"))).toHaveLength(1);
});
