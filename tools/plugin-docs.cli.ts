#!/usr/bin/env bun
/**
 * @file CLI for fetching Better Auth plugin documentation.
 *
 * Usage:
 *   bun tools/plugin-docs.cli.ts --list
 *   bun tools/plugin-docs.cli.ts oidc-provider
 *   bun tools/plugin-docs.cli.ts oidc-provider --schema
 */
import { getPluginInfo, listPlugins } from "./plugin-docs";

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		console.log(`
Plugin Documentation Fetcher

Usage:
  bun tools/plugin-docs.cli.ts --list              List all available plugins
  bun tools/plugin-docs.cli.ts <plugin-name>       Show plugin documentation
  bun tools/plugin-docs.cli.ts <plugin-name> --schema  Show extracted schema info

Examples:
  bun tools/plugin-docs.cli.ts --list
  bun tools/plugin-docs.cli.ts oidc-provider
  bun tools/plugin-docs.cli.ts oidc-provider --schema
`);
		return;
	}

	if (args[0] === "--list") {
		const plugins = await listPlugins();
		console.log("Available Better Auth plugins:\n");
		for (const plugin of plugins) {
			console.log(`  ${plugin.name.padEnd(25)} ${plugin.description}`);
		}
		return;
	}

	const pluginName = args[0];
	const showSchema = args.includes("--schema");

	try {
		const { plugin, schema } = await getPluginInfo(pluginName);

		if (showSchema) {
			console.log(`\nPlugin: ${plugin.name}`);
			console.log(`Description: ${plugin.description}\n`);
			console.log("Extracted Schema Info:");
			const tablesStr = schema.tables.length > 0 ? schema.tables.join(", ") : "(none detected)";
			const fieldsStr = schema.indexedFields.length > 0 ? schema.indexedFields.join(", ") : "(none detected)";
			console.log(`  Tables: ${tablesStr}`);
			console.log(`  Indexed fields: ${fieldsStr}`);
		} else {
			console.log(schema.rawContent);
		}
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}

main();
