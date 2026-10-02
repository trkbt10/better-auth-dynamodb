/**
 * @file Regression checks for reproducible seeds and non-empty chaos verification.
 */
import { resolveChaosSeeds } from "./chaos-seeds";

describe("chaos seed settings", () => {
  it("uses the explicitly supplied default count", () => {
    expect(resolveChaosSeeds({ seed: undefined, runs: undefined, defaultRuns: 3 })).toEqual([1, 2, 3]);
  });

  it("accepts an explicit count", () => {
    expect(resolveChaosSeeds({ seed: undefined, runs: "2", defaultRuns: 40 })).toEqual([1, 2]);
  });

  it("replays seed zero and overrides the count", () => {
    expect(resolveChaosSeeds({ seed: "0", runs: "0", defaultRuns: 40 })).toEqual([0]);
  });

  it("accepts the maximum seed without wrapping", () => {
    expect(resolveChaosSeeds({ seed: "4294967295", runs: undefined, defaultRuns: 40 })).toEqual([0xffffffff]);
  });

  it.each(["0", "-1", "1.5", "invalid", "NaN", "Infinity", "9007199254740992"])(
    "rejects run count %s instead of silently running no scenarios",
    (runs) => {
      expect(() => resolveChaosSeeds({ seed: undefined, runs, defaultRuns: 40 })).toThrow();
    },
  );

  it.each(["-1", "1.5", "invalid", "NaN", "Infinity", "4294967296", "9007199254740992"])(
    "rejects seed %s instead of silently wrapping it",
    (seed) => {
      expect(() => resolveChaosSeeds({ seed, runs: undefined, defaultRuns: 40 })).toThrow();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid default count %s", (defaultRuns) => {
    expect(() => resolveChaosSeeds({ seed: undefined, runs: undefined, defaultRuns })).toThrow();
  });
});
