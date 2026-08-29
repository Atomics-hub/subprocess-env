import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { compileSubprocessEnv } from "../src/index.js";

const iterations = Number.parseInt(
  process.env.SUBPROCESS_ENV_STRESS ?? "100000",
  10,
);
const inherited = Object.fromEntries(
  Array.from({ length: 48 }, (_, index) => [`APP_KEY_${index}`, `${index}`]),
);
Object.assign(inherited, {
  PATH: "/trusted/bin",
  NODE_OPTIONS: "--require=/tmp/evil.js",
  GH_TOKEN: "not-delegated",
});
const apply = compileSubprocessEnv({
  platform: "linux",
  allowInherited: Object.keys(inherited),
  allowOverlay: ["CI"],
});

const started = performance.now();
for (let index = 0; index < iterations; index += 1) {
  const result = apply({ inherited, overlay: { CI: `${index & 1}` } });
  assert.equal(result.ok, true);
  assert.equal(result.env.NODE_OPTIONS, undefined);
  assert.equal(result.env.GH_TOKEN, undefined);
  assert.equal(result.env.CI, `${index & 1}`);
  assert.equal(Object.getPrototypeOf(result.env), null);
}
const elapsedMs = performance.now() - started;
const environmentsPerSecond = Math.round(iterations / (elapsedMs / 1_000));
assert.ok(
  environmentsPerSecond > 1_000,
  `unexpected regression: ${environmentsPerSecond}/s`,
);
console.log(
  JSON.stringify({
    iterations,
    keysPerEnvironment: 52,
    elapsedMs: Math.round(elapsedMs),
    environmentsPerSecond,
  }),
);
