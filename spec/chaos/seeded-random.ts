/**
 * @file Seeded pseudo-random numbers for the chaos specs.
 *
 * Every decision of a chaos run (which request goes next, which read is
 * stale, which request fails) is drawn from one generator, so a run is fully
 * described by its seed and can be replayed.
 */

export type SeededRandom = {
	/** A float in [0, 1). */
	next: () => number;
	/** An integer in [0, maxExclusive). */
	int: (maxExclusive: number) => number;
	/** `true` with the given probability. */
	chance: (probability: number) => boolean;
	pick: <T>(items: readonly T[]) => T;
};

/**
 * mulberry32: a small generator with a 32-bit state, good enough to spread
 * test decisions and identical on every platform.
 */
export const createSeededRandom = (seed: number): SeededRandom => {
	const state = { value: seed >>> 0 };
	const next = (): number => {
		state.value = (state.value + 0x6d2b79f5) >>> 0;
		const mixed = Math.imul(state.value ^ (state.value >>> 15), state.value | 1);
		const scrambled = mixed ^ (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61));
		return ((scrambled ^ (scrambled >>> 14)) >>> 0) / 4294967296;
	};
	const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
	return {
		next,
		int,
		chance: (probability) => next() < probability,
		pick: (items) => {
			if (items.length === 0) {
				throw new Error("Cannot pick from an empty list.");
			}
			return items[int(items.length)];
		},
	};
};
