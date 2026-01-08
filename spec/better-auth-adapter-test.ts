/**
 * @file Wrapper for the Better Auth adapter test runner.
 */
import type { Awaitable, BetterAuthOptions } from "@better-auth/core";
import type { DBAdapter } from "@better-auth/core/db/adapter";
import { runAdapterTest } from "better-auth/adapters/test";

type AdapterTestNames =
	| "CREATE_MODEL"
	| "CREATE_MODEL_SHOULD_ALWAYS_RETURN_AN_ID"
	| "FIND_MODEL"
	| "FIND_MODEL_WITHOUT_ID"
	| "FIND_MODEL_WITH_SELECT"
	| "FIND_MODEL_WITH_MODIFIED_FIELD_NAME"
	| "UPDATE_MODEL"
	| "SHOULD_FIND_MANY"
	| "SHOULD_FIND_MANY_WITH_WHERE"
	| "SHOULD_FIND_MANY_WITH_OPERATORS"
	| "SHOULD_WORK_WITH_REFERENCE_FIELDS"
	| "SHOULD_FIND_MANY_WITH_NOT_IN_OPERATOR"
	| "SHOULD_FIND_MANY_WITH_SORT_BY"
	| "SHOULD_FIND_MANY_WITH_LIMIT"
	| "SHOULD_FIND_MANY_WITH_OFFSET"
	| "SHOULD_UPDATE_WITH_MULTIPLE_WHERE"
	| "DELETE_MODEL"
	| "SHOULD_DELETE_MANY"
	| "SHOULD_NOT_THROW_ON_DELETE_RECORD_NOT_FOUND"
	| "SHOULD_NOT_THROW_ON_RECORD_NOT_FOUND"
	| "SHOULD_FIND_MANY_WITH_CONTAINS_OPERATOR"
	| "SHOULD_SEARCH_USERS_WITH_STARTS_WITH"
	| "SHOULD_SEARCH_USERS_WITH_ENDS_WITH"
	| "SHOULD_PREFER_GENERATE_ID_IF_PROVIDED"
	| "SHOULD_ROLLBACK_FAILING_TRANSACTION"
	| "SHOULD_RETURN_TRANSACTION_RESULT"
	| "SHOULD_FIND_MANY_WITH_CONNECTORS";

type AdapterTestOptions = {
	getAdapter: (
		options?: Omit<BetterAuthOptions, "database">,
	) => Awaitable<DBAdapter<BetterAuthOptions>>;
	disableTests?: Partial<Record<AdapterTestNames, boolean>>;
	testPrefix?: string;
};

const adapterTestDeprecatedWarning =
	"This test function is deprecated and will be removed in the future. Use `testAdapter` instead.";

export const testAdapter = (options: AdapterTestOptions): void => {
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]): void => {
		if (args[0] === adapterTestDeprecatedWarning) {
			return;
		}
		originalWarn(...args);
	};
	try {
		runAdapterTest(options);
	} finally {
		console.warn = originalWarn;
	}
};
