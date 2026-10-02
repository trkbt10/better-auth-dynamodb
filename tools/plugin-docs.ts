/**
 * @file Plugin documentation fetcher from the Better Auth documentation index (llms.txt)
 *
 * Helps developers understand plugin requirements when adding new plugin support.
 * Fetches plugin documentation and extracts schema information (tables, indexes).
 *
 * The site root `https://better-auth.com/llms.txt` is a hub that only links to one
 * documentation index per release line ("Current documentation index" ->
 * `https://better-auth.com/docs/llms.txt`, older lines under `/docs/<major.minor>/llms.txt`).
 * The page list lives in that documentation index, as nested Markdown list items:
 *
 *   - Plugins
 *     - **Authentication**
 *     - [Username](https://better-auth.com/docs/plugins/username.md): Username plugin
 *     - API Key
 *       - [Reference](https://better-auth.com/docs/plugins/api-key/reference.md): API Key plugin options, ...
 *
 * Each linked `.md` URL serves the page as Markdown. A page's schema is written as
 * `Table Name: \`x\`` / `Table: \`x\`` labels and `<DatabaseTable name="x" fields="<identifier>" />`
 * components; the field list itself is a reference to site data and is not part of the Markdown.
 */

const DOCS_INDEX_URL = "https://better-auth.com/docs/llms.txt";

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

type Heading = {
	line: number;
	level: number;
	text: string;
};

type MarkdownTable = {
	header: string[];
	rows: string[][];
};

const IDENTIFIER = "[A-Za-z_][A-Za-z0-9_]*";

/**
 * Fetch the documentation index (the llms.txt that lists every documentation page).
 */
export async function fetchLlmsTxt(): Promise<string> {
	const response = await fetch(DOCS_INDEX_URL);
	if (!response.ok) {
		throw new Error(`Failed to fetch llms.txt: ${response.status}`);
	}
	return response.text();
}

/**
 * Return the plugin slug of a documentation page URL, or undefined when the page is not a plugin page.
 * Plugin pages live under `/docs/plugins/` (or `/docs/<major.minor>/plugins/` for older release lines);
 * sub-pages such as `api-key/reference` keep their sub-path in the slug.
 */
function pluginSlugOf(href: string): string | undefined {
	const { pathname } = new URL(href, DOCS_INDEX_URL);
	const match = pathname.match(/^\/docs\/(?:\d+\.\d+\/)?plugins\/(.+)\.md$/);
	return match?.[1];
}

/**
 * Parse plugin pages from the documentation index (llms.txt) content.
 */
export function parsePluginList(content: string): PluginInfo[] {
	const plugins: PluginInfo[] = [];

	for (const line of content.split("\n")) {
		// Match: <indent>- [Title](https://better-auth.com/docs/plugins/name.md): Description
		const match = line.match(/^\s*-\s+\[[^\]]+\]\(([^)\s]+)\)(?::\s*(.*))?$/);
		if (!match) {
			continue;
		}
		const name = pluginSlugOf(match[1]);
		if (name === undefined) {
			continue;
		}
		plugins.push({
			name,
			path: match[1],
			description: (match[2] ?? "").trim(),
		});
	}

	return plugins;
}

/**
 * Fetch plugin documentation markdown. `pluginPath` is the link target from the index
 * (an absolute URL, or a path resolved against the documentation index).
 */
export async function fetchPluginDoc(pluginPath: string): Promise<string> {
	const url = new URL(pluginPath, DOCS_INDEX_URL).href;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch plugin doc from ${url}: ${response.status}`);
	}
	return response.text();
}

/**
 * List the ATX headings of a Markdown document, skipping fenced code blocks.
 */
function findHeadings(lines: readonly string[]): Heading[] {
	const headings: Heading[] = [];
	const fence = { open: false };

	lines.forEach((line, index) => {
		if (/^\s*(?:```|~~~)/.test(line)) {
			fence.open = !fence.open;
			return;
		}
		if (fence.open) {
			return;
		}
		const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
		if (match) {
			// Strip the anchor suffix: "## Schema [#schema]" -> "Schema"
			const text = match[2].replace(/\s*\[#[^\]]*\]$/, "");
			headings.push({ line: index, level: match[1].length, text });
		}
	});

	return headings;
}

/**
 * Return the bodies of the schema sections ("## Schema", "### Database Schema"), each running
 * up to the next heading of the same or a higher level.
 */
function schemaSections(markdown: string): string[] {
	const lines = markdown.split("\n");
	const headings = findHeadings(lines);

	return headings
		.filter((heading) => /^(?:database\s+)?schema$/i.test(heading.text))
		.map((heading) => {
			const next = headings.find((other) => other.line > heading.line && other.level <= heading.level);
			return lines.slice(heading.line + 1, next?.line ?? lines.length).join("\n");
		});
}

/**
 * Split one Markdown table row into trimmed cells.
 */
function tableCells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

/**
 * Collect the pipe tables of a Markdown section (header row, delimiter row, body rows).
 */
function markdownTables(section: string): MarkdownTable[] {
	const tables: MarkdownTable[] = [];
	const rows: string[] = [];

	for (const line of [...section.split("\n"), ""]) {
		if (/^\s*\|.*\|\s*$/.test(line)) {
			rows.push(line);
			continue;
		}
		// Delimiter row: "| ----- | :---: |" (pipes, colons, spaces, and at least one dash)
		if (rows.length >= 2 && /^[\s|:]*-[\s|:-]*$/.test(rows[1])) {
			tables.push({ header: tableCells(rows[0]), rows: rows.slice(2).map(tableCells) });
		}
		rows.length = 0;
	}

	return tables;
}

/**
 * Return the identifier written in a table cell (`` `scimUser` `` or `userId`), or undefined.
 */
function cellIdentifier(cell: string): string | undefined {
	const match = cell.match(new RegExp(`^\`?(${IDENTIFIER})\`?$`));
	return match?.[1];
}

/**
 * Extract schema information from plugin documentation.
 *
 * Tables come from `<DatabaseTable name="x" ... />` components and `Table Name: \`x\`` / `Table: \`x\``
 * labels anywhere in the page, and, inside the schema sections, from "Model" tables and prose
 * naming a `` `x` table ``. Indexed fields come from "Field" tables inside the schema sections whose
 * row marks the field as a primary key, a reference, unique, or indexed. Field lists rendered by
 * `<DatabaseTable fields="<identifier>" />` are not part of the Markdown and cannot be read here.
 */
export function extractSchemaInfo(markdown: string): SchemaInfo {
	const tables: string[] = [];
	const indexedFields: string[] = [];

	const addUnique = (list: string[], value: string | undefined): void => {
		if (value !== undefined && !list.includes(value)) {
			list.push(value);
		}
	};

	const pagePatterns = [
		// <DatabaseTable name="oauthClient" fields="oauthClientTableFields" />
		new RegExp(`<DatabaseTable\\b[^>]*\\bname=["'](${IDENTIFIER})["']`, "g"),
		// Table Name: `oauthClient` / Table: `twoFactor`
		new RegExp(`^Table(?: Name)?:\\s*\`(${IDENTIFIER})\``, "gm"),
	];
	for (const pattern of pagePatterns) {
		for (const match of markdown.matchAll(pattern)) {
			addUnique(tables, match[1]);
		}
	}

	for (const section of schemaSections(markdown)) {
		// "The SIWE plugin adds a `walletAddress` table to store user wallet associations:"
		for (const match of section.matchAll(new RegExp(`\`(${IDENTIFIER})\` tables?\\b`, "g"))) {
			addUnique(tables, match[1]);
		}

		for (const table of markdownTables(section)) {
			const kind = table.header[0]?.toLowerCase();
			if (kind === "model") {
				for (const row of table.rows) {
					addUnique(tables, cellIdentifier(row[0] ?? ""));
				}
			}
			if (kind === "field") {
				for (const row of table.rows) {
					const isIndexed = /primary key|foreign key|reference|unique|index/i.test(row.slice(1).join(" "));
					if (isIndexed) {
						addUnique(indexedFields, cellIdentifier(row[0] ?? ""));
					}
				}
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
