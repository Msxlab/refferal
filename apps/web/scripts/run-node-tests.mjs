import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const NODE_TEST_PATTERN = /\.node\.test\.(?:cjs|js|mjs|ts)$/;
const IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules"]);

export async function discoverNodeTests(rootDirectory) {
  const discovered = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (entry.isFile() && NODE_TEST_PATTERN.test(entry.name)) {
        discovered.push(absolutePath);
      }
    }
  }

  await visit(path.resolve(rootDirectory));
  return discovered;
}

export function buildNodeTestArgs(testFiles) {
  return [
    "--experimental-strip-types",
    "--experimental-loader=./scripts/node-test-loader.mjs",
    "--no-warnings",
    "--test",
    ...testFiles,
  ];
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDirectory, "..");
  const testFiles = await discoverNodeTests(packageRoot);

  if (testFiles.length === 0) {
    process.stderr.write("No *.node.test.* files were found.\n");
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(process.execPath, buildNodeTestArgs(testFiles), {
    cwd: packageRoot,
    stdio: "inherit",
  });

  process.exitCode = result.status ?? 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";

if (import.meta.url === entryUrl) {
  await main();
}
