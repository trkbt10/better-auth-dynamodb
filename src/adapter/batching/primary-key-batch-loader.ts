/**
 * @file Microtask-batched primary key loader for DynamoDB adapter.
 */
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { ResolvedDynamoDBAdapterConfig } from "../../adapter";
import { resolveTableName } from "../../dynamodb/mapping/resolve-table-name";
import { batchGetItems } from "../../dynamodb/ops/batch-get";
import { DynamoDBAdapterError } from "../../dynamodb/errors/errors";

export type PrimaryKeyBatchLoader = {
	load: (args: { model: string; key: NativeAttributeValue }) => Promise<Record<string, NativeAttributeValue> | null>;
};

type PendingEntry = {
	key: NativeAttributeValue;
	pending: {
		resolve: (value: Record<string, NativeAttributeValue> | null) => void;
		reject: (error: unknown) => void;
	}[];
};

type LoaderGroup = {
	model: string;
	keyField: string;
	tableName: string;
	scheduled: boolean;
	pendingByToken: Map<string, PendingEntry>;
};

const toKeyToken = (value: NativeAttributeValue): string => String(value);

const buildGroupKey = (props: { tableName: string; keyField: string }): string =>
	`${props.tableName}:${props.keyField}`;

export const createPrimaryKeyBatchLoader = (props: {
	documentClient: DynamoDBDocumentClient;
	adapterConfig: ResolvedDynamoDBAdapterConfig;
	getFieldName: (args: { model: string; field: string }) => string;
	getDefaultModelName: (model: string) => string;
}): PrimaryKeyBatchLoader => {
	if (!props) {
		throw new DynamoDBAdapterError(
			"MISSING_EXECUTOR_INPUT",
			"createPrimaryKeyBatchLoader requires explicit props.",
		);
	}

	const groups = new Map<string, LoaderGroup>();

	const getOrCreateGroup = (model: string): LoaderGroup => {
		const tableName = resolveTableName({
			model,
			getDefaultModelName: props.getDefaultModelName,
			config: props.adapterConfig,
		});
		const keyField = props.getFieldName({ model, field: "id" });
		const groupKey = buildGroupKey({ tableName, keyField });
		const existing = groups.get(groupKey);
		if (existing) {
			return existing;
		}
		const created: LoaderGroup = {
			model,
			keyField,
			tableName,
			scheduled: false,
			pendingByToken: new Map<string, PendingEntry>(),
		};
		groups.set(groupKey, created);
		return created;
	};

	const flushGroup = async (group: LoaderGroup): Promise<void> => {
		if (group.pendingByToken.size === 0) {
			group.scheduled = false;
			return;
		}

		const currentPending = new Map(group.pendingByToken);
		group.pendingByToken.clear();
		group.scheduled = false;

		const keys = Array.from(currentPending.values()).map((entry) => entry.key);
		if (props.adapterConfig.explainQueryPlans) {
			const chunkCount = Math.ceil(keys.length / 100);
			console.log(
				[
					"EXPLAIN DynamoDBAdapter",
					`BATCH-GET model=${group.model} table=${group.tableName} key=${group.keyField}`,
					"PLAN",
					`  -> BATCH-GET keys=${keys.length} chunks=${chunkCount} estimatedCommands=${chunkCount}`,
				].join("\n"),
			);
		}

		try {
			const items = await batchGetItems({
				documentClient: props.documentClient,
				tableName: group.tableName,
				keyField: group.keyField,
				keys,
				explainDynamoOperations: props.adapterConfig.explainDynamoOperations,
			});

			const itemMap = new Map<string, Record<string, NativeAttributeValue>>();
			for (const item of items) {
				const keyValue = item[group.keyField];
				if (keyValue === undefined) {
					continue;
				}
				itemMap.set(toKeyToken(keyValue), item);
			}

			for (const [token, entry] of currentPending.entries()) {
				const resolved = itemMap.get(token) ?? null;
				for (const pending of entry.pending) {
					pending.resolve(resolved);
				}
			}
		} catch (error) {
			for (const entry of currentPending.values()) {
				for (const pending of entry.pending) {
					pending.reject(error);
				}
			}
		}
	};

	const scheduleFlush = (group: LoaderGroup): void => {
		if (group.scheduled) {
			return;
		}
		group.scheduled = true;
		queueMicrotask(() => {
			void flushGroup(group);
		});
	};

	return {
		load: async (args) => {
			const group = getOrCreateGroup(args.model);
			const token = toKeyToken(args.key);
			return new Promise<Record<string, NativeAttributeValue> | null>((resolve, reject) => {
				const existing = group.pendingByToken.get(token);
				if (existing) {
					existing.pending.push({ resolve, reject });
					return;
				}
				group.pendingByToken.set(token, {
					key: args.key,
					pending: [{ resolve, reject }],
				});
				scheduleFlush(group);
			});
		},
	};
};
