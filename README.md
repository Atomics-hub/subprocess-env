# subprocess-env

Compile a provenance-aware environment object before starting a child process.

`subprocess-env` keeps inherited process state separate from untrusted overlays, applies source-specific policy, and returns both a null-prototype `env` object and a value-free decision receipt. It is built for CLIs, coding agents, CI runners, MCP hosts, plugin systems, and anything else that starts tools on somebody else's behalf.

```bash
npm install subprocess-env
```

```ts
import { spawn } from "node:child_process";
import { compileSubprocessEnv } from "subprocess-env";

const applyChildEnv = compileSubprocessEnv({
  profile: "untrusted",
  allowInherited: ["APP_MODE"],
  allowOverlay: ["CI", "FORCE_COLOR"],
  delegateSecrets: ["GH_TOKEN"],
});

const decision = applyChildEnv({
  inherited: process.env,
  overlay: workspaceConfig.env,
});

if (!decision.ok) {
  throw new Error(decision.diagnostics[0]?.reason ?? "invalid environment");
}

spawn(command, args, { env: decision.env });
```

The two input records are intentionally separate. A flattened `{ ...process.env, ...workspaceEnv }` object has already erased the fact that one value was inherited and another came from an untrusted workspace, so this package does not accept that shortcut.

## What it guarantees

For an accepted decision:

- output has a null prototype and string values only;
- names use a portable `^[A-Za-z_][A-Za-z0-9_]*$` form and values cannot contain NUL;
- Windows names are compared case-insensitively, so `Path`, `PATH`, and `path` cannot survive as aliases;
- untrusted overlays are allowlist-only;
- known loader and startup controls such as `NODE_OPTIONS`, `LD_PRELOAD`, `BASH_ENV`, `PYTHONPATH`, and `JAVA_TOOL_OPTIONS` are removed from both sources;
- known executable, config, repository, and trust-store selectors cannot come from overlays—even if accidentally included in `allowOverlay`;
- inherited secret-shaped names require exact delegation;
- entry, key, value, and total-byte budgets are enforced before partial output can escape;
- receipts contain keys and reasons, never values.

This is an environment policy compiler, not a process sandbox. See [Security boundary](#security-boundary).

## Profiles

### `untrusted` (default)

Only a small cross-platform inherited baseline plus `allowInherited` is kept. Overlays remain allowlist-only. Loader/startup controls and undelegated secrets are still removed.

The Unix baseline is `PATH`, `LANG`, `LC_ALL`, `TERM`, `COLORTERM`, and `TZ`. The Windows baseline additionally covers command-resolution and operating-system essentials such as `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, and `SystemDrive`.

### `compatible`

All inherited string entries are kept except known all-source controls and undelegated secrets. Overlays remain allowlist-only and overlay controls remain blocked.

Use this when preserving an existing parent environment matters more than minimizing it. It is compatibility-oriented; it is not a claim that arbitrary inherited state is harmless.

```ts
const apply = compileSubprocessEnv({
  profile: "compatible",
  allowOverlay: ["CI"],
});
```

## Exact delegation and escape hatches

Secrets are delegated from the inherited source by exact name:

```ts
const apply = compileSubprocessEnv({
  delegateSecrets: ["GH_TOKEN", "SENTRY_AUTH_TOKEN"],
});
```

An inherited runtime control can be retained only through a separate, deliberately long option. The exception is exact and never authorizes an overlay value:

```ts
const apply = compileSubprocessEnv({
  dangerouslyAllowInheritedControls: ["NODE_OPTIONS"],
});
```

Prefer changing the child command or its explicit arguments. This escape hatch exists for migrations where the parent already depends on a control and the caller has separately established its provenance.

## Decisions and receipts

```ts
const decision = apply({
  inherited: {
    PATH: "/usr/bin:/bin",
    NODE_OPTIONS: "--require=/tmp/hook.js",
  },
  overlay: { CI: "1", PATH: "/workspace/bin" },
});

decision.env;
// [Object: null prototype] { PATH: "/usr/bin:/bin", CI: "1" }

decision.receipt;
// [
//   { key: "PATH", source: "inherited", action: "kept", reason: "baseline-inherited" },
//   { key: "NODE_OPTIONS", source: "inherited", action: "removed", reason: "runtime-control", rule: "NODE_OPTIONS" },
//   { key: "CI", source: "overlay", action: "kept", reason: "allowed-overlay" },
//   { key: "PATH", source: "overlay", action: "removed", reason: "untrusted-control-override", rule: "PATH" }
// ]
```

Receipts never contain values. Keys are capped at 128 characters, and the complete receipt is bounded by the environment entry budget.

If a structural or resource budget fails, `ok` is `false`, `env` is empty, and no partially compiled environment is returned. A successful decision without `PATH` includes a `path-not-provided` warning because Node's executable lookup fallback differs by platform.

## Resource limits

Defaults are intentionally generous for ordinary processes and bounded for hostile input:

```ts
compileSubprocessEnv({
  limits: {
    maxEntries: 4_096,
    maxKeyBytes: 256,
    maxValueBytes: 128 * 1_024,
    maxTotalBytes: 1_024 * 1_024,
  },
});
```

Every limit must be a non-negative safe integer. Limits are captured when the compiler is created and checked when it is applied.

## Adapters

The result is a normal `env` option, so no monkey patch or process wrapper is required.

### Node child processes

```ts
import { execFile, fork, spawn } from "node:child_process";

spawn(file, args, { env: decision.env });
execFile(file, args, { env: decision.env }, callback);
fork(modulePath, args, { env: decision.env });
```

### Execa

```ts
import { execa } from "execa";

await execa(file, args, {
  env: decision.env,
  extendEnv: false,
});
```

`extendEnv: false` matters: extending from `process.env` after compilation would restore the state that policy removed.

### MCP stdio transport

```ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command,
  args,
  env: decision.env,
});
```

Compile once per trust boundary or policy configuration. Apply the compiled function for each child environment.

## Runtime-control corpus

The curated rule corpus is exported in code and as versioned JSON:

```ts
import {
  getRuntimeControlRule,
  policyVersion,
  runtimeControlRules,
} from "subprocess-env";

getRuntimeControlRule("NODE_OPTIONS");
```

```js
import rules from "subprocess-env/rules.json" with { type: "json" };
```

Each rule includes match type, platform, runtime, category, source scope, rationale, and primary evidence. Prefix rules are used only for documented namespaces. Corpus changes require a fixture and primary evidence; see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security boundary

`subprocess-env` decides which environment entries reach a child. It does **not** provide:

- shell escaping or command approval;
- executable integrity or absolute-path enforcement;
- working-directory containment;
- filesystem, network, syscall, or OS sandboxing;
- process-tree cleanup;
- secret storage or redaction after delegation;
- dotenv parsing;
- validation of command arguments or tool output.

For untrusted commands, combine environment policy with absolute executables, argument validation, a controlled working directory, least-privilege credentials, and an operating-system isolation boundary appropriate to the threat model.

## Why this exists

Subprocess environment bugs recur because a filter written for one tool is copied into another after the provenance of each value has already been lost. Recent public fixes have separately handled `PATH`, `STATE_DIRECTORY`, `npm_execpath`, `CLOUDSDK_PYTHON`, Git repository selectors, Node startup controls, Windows essentials, and token inheritance. The hard part is not deleting one dangerous key; it is preserving compatibility while treating inherited state and untrusted overlays as different sources.

This package makes that distinction the API.

## Requirements

- Node.js 18 or newer
- zero runtime dependencies
- ESM and CommonJS builds

## License

MIT
