import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSubprocessEnv } from "../../src/index.js";

const expectRejected = (
  result: ReturnType<ReturnType<typeof compileSubprocessEnv>>,
  code: string,
) => {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.env), []);
  assert.equal(result.receipt.length, 1);
  assert.equal(result.receipt[0]?.reason, "environment-rejected");
  assert.equal(result.diagnostics[0]?.code, code);
  assert.equal(result.diagnostics[0]?.severity, "error");
};

describe("resource budgets", () => {
  it("rejects invalid limits when applied", () => {
    for (const limits of [
      { maxEntries: -1 },
      { maxKeyBytes: 1.5 },
      { maxValueBytes: Number.POSITIVE_INFINITY },
      { maxTotalBytes: Number.NaN },
    ]) {
      expectRejected(
        compileSubprocessEnv({ limits })({ inherited: { PATH: "/bin" } }),
        "invalid-limit",
      );
    }
  });

  it("bounds combined entry count", () => {
    expectRejected(
      compileSubprocessEnv({ limits: { maxEntries: 1 } })({
        inherited: { PATH: "/bin" },
        overlay: { CI: "1" },
      }),
      "environment-entry-budget-exceeded",
    );
  });

  it("bounds UTF-8 key bytes", () => {
    expectRejected(
      compileSubprocessEnv({ limits: { maxKeyBytes: 3 } })({
        inherited: { PATH: "/bin" },
      }),
      "environment-key-budget-exceeded",
    );
  });

  it("bounds UTF-8 value bytes", () => {
    expectRejected(
      compileSubprocessEnv({ limits: { maxValueBytes: 3 } })({
        inherited: { PATH: "💥" },
      }),
      "environment-value-budget-exceeded",
    );
  });

  it("bounds the combined serialized environment size", () => {
    expectRejected(
      compileSubprocessEnv({ limits: { maxTotalBytes: 8 } })({
        inherited: { PATH: "/bin" },
      }),
      "environment-total-budget-exceeded",
    );
  });

  it("bounds receipt key material", () => {
    const key = `A${"B".repeat(200)}`;
    const result = compileSubprocessEnv({ limits: { maxKeyBytes: 1_000 } })({
      inherited: { [key]: "value" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.receipt[0]?.key?.length, 128);
    assert.equal(result.receipt[0]?.keyTruncated, true);
  });
});
