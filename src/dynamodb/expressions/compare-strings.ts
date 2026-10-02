/**
 * @file String ordering as DynamoDB applies it.
 *
 * DynamoDB orders strings by their UTF-8 bytes, which is the order of their
 * Unicode code points. JavaScript's `<` compares UTF-16 code units and puts
 * characters outside the Basic Multilingual Plane (surrogate pairs) before
 * U+E000–U+FFFF. Rows sorted or compared in memory have to follow DynamoDB,
 * or a page computed here would differ from the one an index returns.
 */

/**
 * Compare two strings by code point: negative when `left` sorts first,
 * positive when `right` does, 0 when they are equal.
 */
export const compareStrings = (left: string, right: string): number => {
	if (left === right) {
		return 0;
	}
	const leftPoints = Array.from(left);
	const rightPoints = Array.from(right);
	const length = Math.min(leftPoints.length, rightPoints.length);
	for (let index = 0; index < length; index += 1) {
		const difference =
			(leftPoints[index].codePointAt(0) ?? 0) -
			(rightPoints[index].codePointAt(0) ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return leftPoints.length - rightPoints.length;
};
