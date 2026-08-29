import {
  compileSubprocessEnv,
  type EnvironmentDecision,
  type RuntimeControlRule,
} from "../../src/index.js";

const apply = compileSubprocessEnv({
  profile: "untrusted",
  allowInherited: ["APP_MODE"],
  allowOverlay: ["CI"],
  delegateSecrets: ["GH_TOKEN"],
});
const decision: EnvironmentDecision = apply({
  inherited: process.env,
  overlay: { CI: "1" },
});
if (decision.ok) {
  const env: Record<string, string> = decision.env;
  void env;
} else {
  const code: string = decision.diagnostics[0]?.code ?? "unknown";
  void code;
}
const rule: RuntimeControlRule | undefined = undefined;
void rule;

// @ts-expect-error profiles are intentionally closed
compileSubprocessEnv({ profile: "magic" });
// @ts-expect-error flattened records erase provenance and are not accepted
apply({ PATH: "/bin" });
