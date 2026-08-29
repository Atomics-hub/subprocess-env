import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileSubprocessEnv } from "../../src/index.js";

const entry = (
  result: ReturnType<ReturnType<typeof compileSubprocessEnv>>,
  key: string,
) => result.receipt.find((item) => item.key === key);

const lastEntry = (
  result: ReturnType<ReturnType<typeof compileSubprocessEnv>>,
  key: string,
) => [...result.receipt].reverse().find((item) => item.key === key);

describe("compileSubprocessEnv", () => {
  it("uses the untrusted profile and baseline inherited keys by default", () => {
    const result = compileSubprocessEnv({ platform: "linux" })({
      inherited: { PATH: "/bin", LANG: "C", APP_MODE: "prod" },
    });
    assert.equal(result.ok, true);
    assert.deepEqual({ ...result.env }, { PATH: "/bin", LANG: "C" });
    assert.equal(entry(result, "PATH")?.reason, "baseline-inherited");
    assert.equal(entry(result, "APP_MODE")?.reason, "inherited-not-allowed");
    assert.equal(Object.getPrototypeOf(result.env), null);
  });

  it("keeps source provenance separate and overlays only named keys", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      allowInherited: ["APP_MODE"],
      allowOverlay: ["CI", "FORCE_COLOR"],
    })({
      inherited: { PATH: "/trusted", APP_MODE: "prod", CI: "trusted" },
      overlay: { CI: "1", FORCE_COLOR: "1", APP_MODE: "evil" },
    });
    assert.deepEqual(
      { ...result.env },
      { PATH: "/trusted", APP_MODE: "prod", CI: "1", FORCE_COLOR: "1" },
    );
    assert.equal(entry(result, "CI")?.action, "removed");
    assert.equal(entry(result, "CI")?.reason, "inherited-not-allowed");
    assert.equal(lastEntry(result, "CI")?.action, "kept");
    assert.equal(lastEntry(result, "APP_MODE")?.reason, "overlay-not-allowed");
  });

  it("blocks all-source runtime loaders even when allowlisted", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      allowInherited: ["NODE_OPTIONS", "LD_PRELOAD"],
      allowOverlay: ["NODE_OPTIONS", "LD_PRELOAD"],
    })({
      inherited: {
        PATH: "/bin",
        NODE_OPTIONS: "--require=/tmp/inherited.js",
        LD_PRELOAD: "/tmp/inherited.so",
      },
      overlay: {
        NODE_OPTIONS: "--require=/tmp/overlay.js",
        LD_PRELOAD: "/tmp/overlay.so",
      },
    });
    assert.deepEqual({ ...result.env }, { PATH: "/bin" });
    assert.equal(
      result.receipt.filter((item) => item.reason === "runtime-control").length,
      4,
    );
    assert.ok(
      result.receipt.every((item) => !("value" in item)),
      "receipts must never contain values",
    );
  });

  it("requires an exact, conspicuous exception for inherited runtime controls", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      dangerouslyAllowInheritedControls: ["NODE_OPTIONS"],
      allowOverlay: ["NODE_OPTIONS"],
    })({
      inherited: { PATH: "/bin", NODE_OPTIONS: "--no-warnings" },
      overlay: { NODE_OPTIONS: "--require=/tmp/evil.js" },
    });
    assert.equal(result.env.NODE_OPTIONS, "--no-warnings");
    assert.equal(
      result.receipt[1]?.reason,
      "dangerously-allowed-inherited-control",
    );
    assert.equal(result.receipt[2]?.reason, "runtime-control");
  });

  it("never authorizes overlay controls through allowOverlay", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      allowOverlay: [
        "PATH",
        "HOME",
        "npm_execpath",
        "GIT_INDEX_FILE",
        "RUSTC_WRAPPER",
      ],
    })({
      inherited: { PATH: "/trusted" },
      overlay: {
        PATH: "/evil",
        HOME: "/evil-home",
        npm_execpath: "/evil/npm",
        GIT_INDEX_FILE: "/evil/index",
        RUSTC_WRAPPER: "/evil/wrapper",
      },
    });
    assert.equal(result.env.PATH, "/trusted");
    assert.equal(Object.keys(result.env).length, 1);
    assert.equal(
      result.receipt.filter(
        (item) => item.reason === "untrusted-control-override",
      ).length,
      5,
    );
  });

  it("delegates inherited secrets by exact name without authorizing other secrets", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      delegateSecrets: ["GH_TOKEN"],
    })({
      inherited: {
        PATH: "/bin",
        GH_TOKEN: "delegated",
        AWS_SECRET_ACCESS_KEY: "removed",
        AWS_ACCESS_KEY_ID: "removed-too",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
      },
    });
    assert.equal(result.env.GH_TOKEN, "delegated");
    assert.equal(result.env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(result.env.AWS_ACCESS_KEY_ID, undefined);
    assert.equal(entry(result, "GH_TOKEN")?.reason, "delegated-secret");
    assert.equal(
      entry(result, "AWS_SECRET_ACCESS_KEY")?.reason,
      "secret-not-delegated",
    );
    assert.equal(
      entry(result, "SSH_AUTH_SOCK")?.reason,
      "inherited-not-allowed",
      "AUTH in a normal name must not trigger the secret heuristic",
    );
  });

  it("allows explicitly named overlay values even when their names look secret", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      allowOverlay: ["SESSION_TOKEN"],
    })({ overlay: { SESSION_TOKEN: "workspace-value" } });
    assert.equal(result.env.SESSION_TOKEN, "workspace-value");
    assert.equal(entry(result, "SESSION_TOKEN")?.reason, "allowed-overlay");
  });

  it("provides a precisely bounded compatible profile", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      profile: "compatible",
    })({
      inherited: {
        PATH: "/bin",
        APP_MODE: "prod",
        GH_TOKEN: "secret",
        NODE_OPTIONS: "--require=/tmp/evil.js",
      },
    });
    assert.equal(result.env.APP_MODE, "prod");
    assert.equal(entry(result, "APP_MODE")?.reason, "compatible-inherited");
    assert.equal(result.env.GH_TOKEN, undefined);
    assert.equal(result.env.NODE_OPTIONS, undefined);
  });

  it("uses Windows case-insensitive identity and keeps the final approved spelling", () => {
    const result = compileSubprocessEnv({
      platform: "win32",
      allowInherited: ["APP_MODE"],
      allowOverlay: ["APP_MODE"],
    })({
      inherited: { Path: "C:\\trusted", App_Mode: "one" },
      overlay: { APP_MODE: "two", app_mode: "three", PATH: "C:\\evil" },
    });
    assert.deepEqual(Object.keys(result.env), ["Path", "app_mode"]);
    assert.equal(result.env.Path, "C:\\trusted");
    assert.equal(result.env.app_mode, "three");
    assert.equal(
      new Set(Object.keys(result.env).map((key) => key.toUpperCase())).size,
      Object.keys(result.env).length,
    );
  });

  it("preserves distinct case-sensitive keys on Unix", () => {
    const result = compileSubprocessEnv({
      platform: "linux",
      allowInherited: ["FOO", "foo"],
    })({ inherited: { FOO: "upper", foo: "lower" } });
    assert.equal(result.env.FOO, "upper");
    assert.equal(result.env.foo, "lower");
  });

  it("rejects invalid names and non-string or NUL values", () => {
    const inherited = Object.create(null) as Record<string, unknown>;
    inherited.PATH = "/bin";
    inherited["BAD=NAME"] = "x";
    inherited[""] = "x";
    inherited["1START"] = "x";
    inherited.NON_STRING = 123;
    inherited.UNDEFINED = undefined;
    inherited.NUL = "x\0y";
    const result = compileSubprocessEnv({
      platform: "linux",
      allowInherited: ["NON_STRING", "UNDEFINED", "NUL"],
    })({ inherited });
    assert.deepEqual({ ...result.env }, { PATH: "/bin" });
    assert.equal(
      result.receipt.filter((item) => item.reason === "invalid-name").length,
      3,
    );
    assert.equal(
      result.receipt.filter((item) => item.reason === "invalid-value").length,
      3,
    );
  });

  it("does not invoke accessors", () => {
    let invoked = false;
    const overlay: Record<string, unknown> = {};
    Object.defineProperty(overlay, "SAFE", {
      enumerable: true,
      get() {
        invoked = true;
        return "value";
      },
    });
    const result = compileSubprocessEnv({ allowOverlay: ["SAFE"] })({
      overlay,
    });
    assert.equal(invoked, false);
    assert.equal(entry(result, "SAFE")?.reason, "accessor-entry");
  });

  it("accepts null-prototype inputs and safely handles __proto__ as data", () => {
    const inherited = Object.create(null) as Record<string, unknown>;
    inherited.PATH = "/bin";
    inherited.__proto__ = "data";
    const result = compileSubprocessEnv({
      platform: "linux",
      allowInherited: ["__proto__"],
    })({ inherited });
    assert.equal(result.env.__proto__, "data");
    assert.equal(Object.getPrototypeOf(result.env), null);
  });

  it("rejects class instances, arrays, and hostile proxies without partial output", () => {
    class Environment {
      PATH = "/bin";
    }
    const classResult = compileSubprocessEnv()({
      inherited: new Environment() as unknown as Record<string, unknown>,
    });
    assert.equal(classResult.ok, false);
    assert.equal(classResult.diagnostics[0]?.code, "invalid-source-record");
    assert.deepEqual(Object.keys(classResult.env), []);

    const arrayResult = compileSubprocessEnv()({
      inherited: [] as unknown as Record<string, unknown>,
    });
    assert.equal(arrayResult.ok, false);

    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    const proxyResult = compileSubprocessEnv()({ inherited: proxy });
    assert.equal(proxyResult.ok, false);
  });

  it("rejects malformed compiler options and unknown profiles at runtime", () => {
    const nullOptions = compileSubprocessEnv(
      null as unknown as Parameters<typeof compileSubprocessEnv>[0],
    )();
    assert.equal(nullOptions.ok, false);
    assert.equal(nullOptions.diagnostics[0]?.code, "invalid-options");

    const badNames = compileSubprocessEnv({
      allowOverlay: [123] as unknown as string[],
    })();
    assert.equal(badNames.ok, false);
    assert.equal(badNames.diagnostics[0]?.code, "invalid-options");

    const badPlatform = compileSubprocessEnv({
      platform: 123 as unknown as string,
    })();
    assert.equal(badPlatform.ok, false);

    const hostileOptions = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );
    const trapped = compileSubprocessEnv(hostileOptions)();
    assert.equal(trapped.ok, false);
    assert.equal(trapped.diagnostics[0]?.code, "invalid-options");

    const badProfile = compileSubprocessEnv({
      profile: "unknown" as "untrusted",
    })();
    assert.equal(badProfile.ok, false);
    assert.equal(badProfile.diagnostics[0]?.code, "invalid-profile");
  });

  it("rejects malformed apply wrappers and hostile wrapper proxies", () => {
    const apply = compileSubprocessEnv();
    const nullInput = apply(null as unknown as Parameters<typeof apply>[0]);
    assert.equal(nullInput.ok, false);

    const arrayInput = apply([] as unknown as Parameters<typeof apply>[0]);
    assert.equal(arrayInput.ok, false);

    const wrapper = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    const proxyInput = apply(wrapper);
    assert.equal(proxyInput.ok, false);
  });

  it("returns a PATH warning instead of silently implying command resolution", () => {
    const result = compileSubprocessEnv({ platform: "linux" })({
      inherited: { LANG: "C" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.diagnostics[0]?.code, "path-not-provided");
    assert.equal(result.diagnostics[0]?.severity, "warning");
  });

  it("uses the Windows baseline when compiling for win32", () => {
    const result = compileSubprocessEnv({ platform: "win32" })({
      inherited: {
        Path: "C:\\Windows",
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        APPDATA: "C:\\Users\\me\\AppData",
      },
    });
    assert.equal(result.env.Path, "C:\\Windows");
    assert.equal(result.env.SystemRoot, "C:\\Windows");
    assert.equal(result.env.WINDIR, "C:\\Windows");
    assert.equal(result.env.APPDATA, undefined);
  });
});
