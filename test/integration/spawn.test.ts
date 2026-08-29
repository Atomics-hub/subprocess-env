import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { compileSubprocessEnv } from "../../src/index.js";

describe("real child process", () => {
  it("passes the compiled environment directly to Node spawn", () => {
    const decision = compileSubprocessEnv({
      allowInherited: ["APP_MODE"],
      allowOverlay: ["CI"],
    })({
      inherited: {
        PATH: process.env.PATH,
        APP_MODE: "production",
        NODE_OPTIONS: "--require=/definitely/not/a/real/module.js",
      },
      overlay: { CI: "1", PATH: "/attacker/bin" },
    });
    assert.equal(decision.ok, true);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify({path:Boolean(process.env.PATH),app:process.env.APP_MODE,ci:process.env.CI,nodeOptions:process.env.NODE_OPTIONS}))",
      ],
      { env: decision.env, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      path: true,
      app: "production",
      ci: "1",
    });
  });
});
