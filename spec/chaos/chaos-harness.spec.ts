/**
 * @file Regression checks that failed and empty chaos runs cannot appear as successful verification.
 */
import { NO_FAULTS } from "./chaos-cluster";
import { runChaos } from "./chaos-harness";

const profile = { name: "regression", faults: NO_FAULTS };

describe("chaos verification failures", () => {
  it("rejects an empty seed list", async () => {
    await expect(runChaos({ profile, seeds: [], scenario: async () => [] })).rejects.toThrow("at least one seed");
  });

  it("includes the seed, profile, trace, and original cause when a scenario throws", async () => {
    await expect(runChaos({
      profile,
      seeds: [42],
      scenario: async (environment) => {
        const adapter = environment.createAdapter();
        await environment.cluster.run([
          () => adapter.findOne({ model: "user", where: [{ field: "id", value: "missing" }] }),
        ]);
        throw new Error("unexpected failure");
      },
    })).rejects.toThrow(/unexpected failure[\s\S]*CHAOS_SEED=42[\s\S]*regression[\s\S]*GetCommand/);
  });
});
