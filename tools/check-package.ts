/**
 * @file Pack and test the distributable in a temporary consumer outside this repository.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json";

const root = fileURLToPath(new URL("../", import.meta.url));

const run = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status ?? result.signal}).`);
  }
};

const installedVersion = (name: string): string => {
  const metadata: unknown = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
  if (typeof metadata !== "object" || metadata === null || !("version" in metadata)) {
    throw new Error(`Missing installed version for ${name}.`);
  }
  if (typeof metadata.version !== "string") {
    throw new Error(`Invalid installed version for ${name}.`);
  }
  return metadata.version;
};

mkdirSync(join(root, "artifacts"), { recursive: true });
run("bun", ["run", "pack"], root);

const consumer = mkdtempSync(join(tmpdir(), "better-auth-dynamodb-consumer-"));
try {
  cpSync(join(root, "spec/package/consumer"), consumer, { recursive: true });
  const dependencies = Object.fromEntries(
    Object.keys(packageJson.peerDependencies).map((name) => [name, installedVersion(name)]),
  );
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "package-consumer",
      private: true,
      type: "module",
      dependencies: {
        ...dependencies,
        [packageJson.name]: `file:${join(root, "artifacts/package.tgz")}`,
      },
      devDependencies: {
        typescript: installedVersion("typescript"),
        "@types/node": installedVersion("@types/node"),
        "bun-types": installedVersion("bun-types"),
      },
      overrides: {
        "@types/node": installedVersion("@types/node"),
      },
    }, null, 2),
  );
  run("bun", ["install", "--ignore-scripts"], consumer);
  run("node", ["runtime.mjs"], consumer);
  run("bun", ["x", "--no-install", "tsc", "-p", "tsconfig.json"], consumer);
  console.log(`Verified ${packageJson.name}@${packageJson.version}: tarball, ESM, CommonJS, and consumer types.`);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
