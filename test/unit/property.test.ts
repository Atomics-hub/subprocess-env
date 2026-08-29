import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  compileSubprocessEnv,
  getRuntimeControlRule,
} from "../../src/index.js";

const portableKey = fc
  .tuple(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_"),
    fc.array(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789"), {
      maxLength: 24,
    }),
  )
  .map(([head, tail]) => head + tail.join(""));

describe("generated invariants", () => {
  it("never retains untrusted runtime controls or unallowlisted overlays", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(portableKey, fc.string({ maxLength: 40 })),
        fc.dictionary(portableKey, fc.string({ maxLength: 40 })),
        async (inherited, overlay) => {
          const result = compileSubprocessEnv({
            platform: "linux",
            allowInherited: Object.keys(inherited),
          })({ inherited, overlay });
          assert.equal(result.ok, true);
          for (const key of Object.keys(result.env)) {
            assert.equal(
              getRuntimeControlRule(key, "linux")?.scope === "all",
              false,
            );
            if (Object.hasOwn(overlay, key) && !Object.hasOwn(inherited, key)) {
              assert.fail(`unallowlisted overlay survived: ${key}`);
            }
          }
          assert.ok(result.receipt.every((item) => !("value" in item)));
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("collapses every Windows key identity deterministically", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(portableKey, fc.string({ maxLength: 20 })),
        async (record) => {
          const result = compileSubprocessEnv({
            platform: "win32",
            profile: "compatible",
          })({ inherited: record });
          assert.equal(result.ok, true);
          const identities = Object.keys(result.env).map((key) =>
            key.toUpperCase(),
          );
          assert.equal(new Set(identities).size, identities.length);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("is deterministic and never mutates either source", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(portableKey, fc.string({ maxLength: 20 })),
        fc.dictionary(portableKey, fc.string({ maxLength: 20 })),
        async (inherited, overlay) => {
          const beforeInherited = Object.entries(inherited);
          const beforeOverlay = Object.entries(overlay);
          const apply = compileSubprocessEnv({
            platform: "linux",
            profile: "compatible",
            allowOverlay: Object.keys(overlay),
          });
          const first = apply({ inherited, overlay });
          const second = apply({ inherited, overlay });
          assert.deepEqual(first, second);
          assert.deepEqual(Object.entries(inherited), beforeInherited);
          assert.deepEqual(Object.entries(overlay), beforeOverlay);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
