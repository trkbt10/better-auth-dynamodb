/**
 * @file DynamoDB key helpers.
 */
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
export declare const buildPrimaryKey: (props: {
    item: Record<string, NativeAttributeValue>;
    keyField: string;
}) => Record<string, NativeAttributeValue>;
//# sourceMappingURL=build-primary-key.d.ts.map