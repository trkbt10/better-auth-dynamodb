/**
 * @file Plugin documentation fetcher from Better Auth llms.txt
 *
 * Helps developers understand plugin requirements when adding new plugin support.
 * Fetches plugin documentation and extracts schema information (tables, indexes).
 */

const BASE_URL = "https://www.better-auth.com";
const LLMS_TXT_URL = `${BASE_URL}/llms.txt`;

export type PluginInfo = {
	name: string;
	path: string;
	description: string;
};

export type SchemaInfo = {
	tables: string[];
	indexedFields: string[];
	rawContent: string;
};

/**
 * Fetch the llms.txt index file.
 */
export async function fetchLlmsTxt(): Promise<string> {
	const response = await fetch(LLMS_TXT_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch llms.txt: ${response.status}`);
	}
	return response.text();
}

/**
 * Parse plugin URLs from llms.txt content.
 */
export function parsePluginList(content: string): PluginInfo[] {
	const plugins: PluginInfo[] = [];
	const lines = content.split("\n");

	for (const line of lines) {
		// Match: - [Title](/llms.txt/docs/plugins/name.md): Description
		const match = line.match(
			/^-\s*\[([^\]]+)\]\(([^)]+\/plugins\/([^.]+)\.md)\):\s*(.+)$/,
		);
		if (match) {
			plugins.push({
				name: match[3],
				path: match[2],
				description: match[4].trim(),
			});
		}
	}

	return plugins;
}

/**
 * Fetch plugin documentation markdown.
 */
export async function fetchPluginDoc(pluginPath: string): Promise<string> {
	const url = `${BASE_URL}${pluginPath}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch plugin doc from ${url}: ${response.status}`);
	}
	return response.text();
}

/**
 * Extract schema information from plugin documentation.
 */
export function extractSchemaInfo(markdown: string): SchemaInfo {
	const tables: string[] = [];
	const indexedFields: string[] = [];

	const skipWords = new Set([
		"fields",
		"key",
		"migration",
		"schema",
		"database",
		"tables",
		"installation",
		"usage",
		"configuration",
		"options",
		"example",
		"requirements",
		"constraints",
		"index",
	]);

	// Pattern 1: Table Name: `tableName` (Better Auth docs format)
	const tableNamePattern = /Table Name:\s*`([a-zA-Z]+)`/g;
	for (const match of markdown.matchAll(tableNamePattern)) {
		const tableName = match[1];
		if (tableName && !tables.includes(tableName)) {
			tables.push(tableName);
		}
	}

	// Pattern 2: DatabaseTable component - tableName="xxx"
	const dbTablePattern = /tableName=["']([a-zA-Z]+)["']/g;
	for (const match of markdown.matchAll(dbTablePattern)) {
		const tableName = match[1];
		if (tableName && !tables.includes(tableName)) {
			tables.push(tableName);
		}
	}

	// Pattern 2: Markdown headers - ### tableName, ### **tableName**
	const headerPatterns = [
		/###?\s*\d*\.?\s*\**([a-z][a-zA-Z]+)\**/g,
		/##\s*([a-z][a-zA-Z]+)\s+table/gi,
	];

	for (const pattern of headerPatterns) {
		for (const match of markdown.matchAll(pattern)) {
			const tableName = match[1];
			if (tableName !== undefined) {
				if (!skipWords.has(tableName.toLowerCase()) && !tables.includes(tableName)) {
					tables.push(tableName);
				}
			}
		}
	}

	// Extract indexed fields from various formats
	const fieldPatterns = [
		// JSON-like: isForeignKey: true, isPrimaryKey: true
		/name:\s*["']([a-zA-Z]+)["'][^}]*(?:isForeignKey|isPrimaryKey):\s*true/g,
		// Markdown: `fieldName` (FK), (unique), (index)
		/`([a-zA-Z]+)`[^`\n]*(?:FK|Foreign Key|unique|index|Primary Key)/gi,
		// Prose: `fieldName` is indexed/unique
		/`([a-zA-Z]+)`[^`\n]*(?:is\s+)?(?:unique|indexed)/gi,
		// References pattern
		/["']([a-zA-Z]+)["'][^}]*references:\s*\{/g,
	];

	for (const pattern of fieldPatterns) {
		for (const match of markdown.matchAll(pattern)) {
			const fieldName = match[1];
			if (fieldName && !indexedFields.includes(fieldName)) {
				indexedFields.push(fieldName);
			}
		}
	}

	return {
		tables,
		indexedFields,
		rawContent: markdown,
	};
}

/**
 * Get plugin information by name.
 */
export async function getPluginInfo(pluginName: string): Promise<{
	plugin: PluginInfo;
	schema: SchemaInfo;
}> {
	const llmsTxt = await fetchLlmsTxt();
	const plugins = parsePluginList(llmsTxt);

	const plugin = plugins.find((p) => p.name === pluginName);
	if (!plugin) {
		const available = plugins.map((p) => p.name).join(", ");
		throw new Error(`Plugin "${pluginName}" not found. Available: ${available}`);
	}

	const doc = await fetchPluginDoc(plugin.path);
	const schema = extractSchemaInfo(doc);

	return { plugin, schema };
}

/**
 * List all available plugins.
 */
export async function listPlugins(): Promise<PluginInfo[]> {
	const llmsTxt = await fetchLlmsTxt();
	return parsePluginList(llmsTxt);
}
