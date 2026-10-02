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
export declare const compareStrings: (left: string, right: string) => number;
//# sourceMappingURL=compare-strings.d.ts.map