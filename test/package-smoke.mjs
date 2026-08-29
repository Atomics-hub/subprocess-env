import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "subprocess-env-package-"));
const packOutput = execFileSync(
  "npm",
  ["pack", "--json", "--pack-destination", temporary],
  { cwd: root, encoding: "utf8" },
);
const packed = JSON.parse(packOutput)[0];
assert.equal(packed.name, "subprocess-env");
assert.equal(
  packed.files.some((file) => file.path.startsWith("src/")),
  false,
);
assert.equal(
  packed.files.some((file) => file.path.startsWith("test/")),
  false,
);
for (const path of [
  "dist/index.js",
  "dist/index.cjs",
  "dist/index.d.ts",
  "dist/index.d.cts",
  "data/runtime-controls.json",
]) {
  assert.equal(
    packed.files.some((file) => file.path === path),
    true,
    path,
  );
}
assert.ok(
  packed.size < 45_000,
  `tarball is unexpectedly large: ${packed.size}`,
);

const consumer = join(temporary, "consumer");
await mkdir(consumer);
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
const tarball = join(temporary, packed.filename);
execFileSync(
  "npm",
  ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
  { cwd: consumer, stdio: "pipe" },
);
await writeFile(
  join(consumer, "esm.mjs"),
  `import { compileSubprocessEnv } from "subprocess-env";
const r = compileSubprocessEnv({allowOverlay:["CI"]})({inherited:{PATH:"/bin",NODE_OPTIONS:"--require=evil"},overlay:{CI:"1"}});
if (!r.ok || r.env.CI !== "1" || r.env.NODE_OPTIONS !== undefined) process.exitCode = 1;`,
);
await writeFile(
  join(consumer, "cjs.cjs"),
  `const { compileSubprocessEnv } = require("subprocess-env");
const r = compileSubprocessEnv()({inherited:{PATH:"/bin"}});
if (!r.ok || r.env.PATH !== "/bin") process.exitCode = 1;`,
);
await writeFile(
  join(consumer, "rules.mjs"),
  `import rules from "subprocess-env/rules.json" with { type: "json" };
if (!rules.policyVersion || rules.rules.length < 60) process.exitCode = 1;`,
);
await writeFile(
  join(consumer, "types.ts"),
  `import { compileSubprocessEnv, type EnvironmentDecision } from "subprocess-env";
const r: EnvironmentDecision = compileSubprocessEnv()({inherited:{PATH:"/bin"}}); void r;`,
);
await writeFile(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      target: "ES2022",
    },
    include: ["types.ts"],
  }),
);
execFileSync("node", ["esm.mjs"], { cwd: consumer, stdio: "inherit" });
execFileSync("node", ["cjs.cjs"], { cwd: consumer, stdio: "inherit" });
execFileSync("node", ["rules.mjs"], { cwd: consumer, stdio: "inherit" });
execFileSync(
  process.execPath,
  [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  { cwd: consumer, stdio: "inherit" },
);

const installedPackage = JSON.parse(
  await readFile(
    join(consumer, "node_modules/subprocess-env/package.json"),
    "utf8",
  ),
);
assert.equal(installedPackage.dependencies, undefined);
assert.deepEqual(
  (await readdir(join(consumer, "node_modules/subprocess-env"))).sort(),
  [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "data",
    "dist",
    "package.json",
  ],
);
console.log(
  `Packed consumer smoke passed: ${packed.filename} (${packed.size} bytes)`,
);
