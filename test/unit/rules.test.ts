import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  getRuntimeControlRule,
  policyVersion,
  runtimeControlRules,
} from "../../src/index.js";

describe("runtime control corpus", () => {
  it("exports the exact versioned JSON corpus", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("../../data/runtime-controls.json", import.meta.url),
        "utf8",
      ),
    ) as { policyVersion: string; rules: unknown[] };
    assert.equal(policyVersion, raw.policyVersion);
    assert.deepEqual(runtimeControlRules, raw.rules);
  });

  it("requires complete metadata and primary evidence for every rule", () => {
    assert.ok(runtimeControlRules.length >= 60);
    assert.equal(Object.isFrozen(runtimeControlRules), true);
    const identities = new Set<string>();
    for (const rule of runtimeControlRules) {
      assert.equal(Object.isFrozen(rule), true);
      assert.equal(Object.isFrozen(rule.platforms), true);
      assert.equal(Object.isFrozen(rule.runtimes), true);
      assert.equal(Object.isFrozen(rule.evidence), true);
      assert.match(rule.name, /^[A-Za-z_][A-Za-z0-9_]*$/);
      assert.ok(rule.platforms.length > 0);
      assert.ok(rule.runtimes.length > 0);
      assert.ok(rule.category.length > 2);
      assert.ok(rule.reason.endsWith("."));
      assert.ok(rule.evidence.length > 0);
      assert.ok(rule.evidence.every((url) => url.startsWith("https://")));
      const identity = `${rule.name}:${rule.match}:${rule.platforms.join(",")}`;
      assert.equal(
        identities.has(identity),
        false,
        `duplicate rule ${identity}`,
      );
      identities.add(identity);
    }
  });

  it("matches exact, prefix, platform-scoped, and Windows aliases", () => {
    assert.equal(getRuntimeControlRule("NODE_OPTIONS", "linux")?.scope, "all");
    assert.equal(
      getRuntimeControlRule("npm_config_userconfig", "linux")?.name,
      "npm_config_",
    );
    assert.equal(
      getRuntimeControlRule("DYLD_INSERT_LIBRARIES", "darwin")?.name,
      "DYLD_",
    );
    assert.equal(getRuntimeControlRule("LUA_INITIALIZED", "linux"), undefined);
    assert.equal(
      getRuntimeControlRule("LUA_INIT_5_4", "linux")?.name,
      "LUA_INIT_",
    );
    assert.equal(
      getRuntimeControlRule("DYLD_INSERT_LIBRARIES", "linux"),
      undefined,
    );
    assert.equal(
      getRuntimeControlRule("node_options", "win32")?.name,
      "NODE_OPTIONS",
    );
    assert.equal(getRuntimeControlRule("ordinary_key", "linux"), undefined);
  });
});
