/**
 * @file DynamoDB update expression builder.
 *
 * An update assigns the attributes it is given, each as a whole value: a
 * defined value becomes a `SET`, `undefined` a `REMOVE`. The expression is
 * built from the update alone, never from a comparison with the row that was
 * read. A diff against that row would skip a value that looked unchanged and
 * patch lists and maps element by element, both of which go wrong as soon as
 * another writer changed the row in between.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export type DynamoDBUpdateExpression = {
    updateExpression: string;
    expressionAttributeNames: Record<string, string>;
    expressionAttributeValues: Record<string, NativeAttributeValue>;
};
export declare const buildUpdateExpression: (update: Record<string, NativeAttributeValue | undefined>) => DynamoDBUpdateExpression;
