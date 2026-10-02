/**
 * @file Validate chaos seed/count inputs so invalid settings cannot silently skip verification.
 */
const parseInteger = (value: string | undefined, name: string): number | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer; received "${value}".`);
  }
  return parsed;
};

export const resolveChaosSeeds = (props: {
  seed: string | undefined;
  runs: string | undefined;
  defaultRuns: number;
}): number[] => {
  const single = parseInteger(props.seed, "CHAOS_SEED");
  if (single !== undefined) {
    if (single > 0xffffffff) {
      throw new Error("CHAOS_SEED must fit in an unsigned 32-bit integer.");
    }
    return [single];
  }
  const runs = parseInteger(props.runs, "Chaos run count") ?? props.defaultRuns;
  if (!Number.isSafeInteger(runs) || runs <= 0) {
    throw new Error("Chaos run count must be a positive safe integer.");
  }
  return Array.from({ length: runs }, (_, index) => index + 1);
};
