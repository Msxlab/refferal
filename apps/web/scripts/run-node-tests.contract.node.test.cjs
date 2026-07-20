const assert = require("node:assert/strict");
const { mkdtemp, mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

test("discovers node contract tests recursively and in stable order", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "refearn-node-tests-"));

  try {
    await mkdir(path.join(fixtureRoot, "nested"), { recursive: true });
    await Promise.all([
      writeFile(path.join(fixtureRoot, "z.node.test.ts"), ""),
      writeFile(path.join(fixtureRoot, "nested", "a.node.test.cjs"), ""),
      writeFile(path.join(fixtureRoot, "nested", "ignored.test.ts"), ""),
    ]);

    const runnerUrl = pathToFileURL(path.join(__dirname, "run-node-tests.mjs")).href;
    const { discoverNodeTests } = await import(runnerUrl);

    assert.deepEqual(
      (await discoverNodeTests(fixtureRoot)).map((file) => path.relative(fixtureRoot, file)),
      [path.join("nested", "a.node.test.cjs"), "z.node.test.ts"],
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("builds the Node command with type stripping and the native test runner", async () => {
  const runnerUrl = pathToFileURL(path.join(__dirname, "run-node-tests.mjs")).href;
  const { buildNodeTestArgs } = await import(runnerUrl);

  assert.deepEqual(buildNodeTestArgs(["one.node.test.ts", "two.node.test.cjs"]), [
    "--experimental-strip-types",
    "--experimental-loader=./scripts/node-test-loader.mjs",
    "--no-warnings",
    "--test",
    "one.node.test.ts",
    "two.node.test.cjs",
  ]);
});
