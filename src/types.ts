export type SubprocessEnvProfile = "untrusted" | "compatible";
export type EnvironmentSource = "inherited" | "overlay";
export type RuleScope = "all" | "overlay";

export interface RuntimeControlRule {
  readonly name: string;
  readonly match: "exact" | "prefix";
  readonly platforms: readonly string[];
  readonly runtimes: readonly string[];
  readonly category: string;
  readonly scope: RuleScope;
  readonly reason: string;
  readonly evidence: readonly string[];
}

export interface EnvironmentLimits {
  readonly maxEntries: number;
  readonly maxKeyBytes: number;
  readonly maxValueBytes: number;
  readonly maxTotalBytes: number;
}

export interface CompileSubprocessEnvOptions {
  /** `untrusted` is allowlist-only. `compatible` inherits non-control, non-secret keys. */
  readonly profile?: SubprocessEnvProfile;
  /** Defaults to process.platform. Primarily useful for planning and tests. */
  readonly platform?: string;
  readonly allowInherited?: readonly string[];
  readonly allowOverlay?: readonly string[];
  /** Explicitly delegates inherited secret-shaped names. Never authorizes overlays. */
  readonly delegateSecrets?: readonly string[];
  /** Exact inherited control names to retain. Never authorizes overlays. */
  readonly dangerouslyAllowInheritedControls?: readonly string[];
  readonly limits?: Partial<EnvironmentLimits>;
}

export type EnvironmentInput = Readonly<Record<string, unknown>>;

export interface ApplySubprocessEnvInput {
  readonly inherited?: EnvironmentInput;
  readonly overlay?: EnvironmentInput;
}

export type ReceiptAction = "kept" | "removed" | "replaced" | "rejected";

export type ReceiptReason =
  | "baseline-inherited"
  | "allowed-inherited"
  | "compatible-inherited"
  | "delegated-secret"
  | "dangerously-allowed-inherited-control"
  | "allowed-overlay"
  | "allowed-overlay-replacement"
  | "runtime-control"
  | "untrusted-control-override"
  | "secret-not-delegated"
  | "inherited-not-allowed"
  | "overlay-not-allowed"
  | "invalid-name"
  | "invalid-value"
  | "accessor-entry"
  | "environment-rejected";

export interface EnvironmentReceiptEntry {
  readonly key?: string;
  readonly keyTruncated?: true;
  readonly source?: EnvironmentSource;
  readonly action: ReceiptAction;
  readonly reason: ReceiptReason;
  readonly rule?: string;
}

export type DiagnosticCode =
  | "path-not-provided"
  | "invalid-source-record"
  | "environment-entry-budget-exceeded"
  | "environment-key-budget-exceeded"
  | "environment-value-budget-exceeded"
  | "environment-total-budget-exceeded"
  | "invalid-options"
  | "invalid-profile"
  | "invalid-limit";

export interface EnvironmentDiagnostic {
  readonly severity: "warning" | "error";
  readonly code: DiagnosticCode;
  readonly reason: string;
}

export interface SuccessfulEnvironmentDecision {
  readonly ok: true;
  readonly env: Record<string, string>;
  readonly receipt: readonly EnvironmentReceiptEntry[];
  readonly diagnostics: readonly EnvironmentDiagnostic[];
}

export interface RejectedEnvironmentDecision {
  readonly ok: false;
  readonly env: Record<string, string>;
  readonly receipt: readonly EnvironmentReceiptEntry[];
  readonly diagnostics: readonly EnvironmentDiagnostic[];
}

export type EnvironmentDecision =
  SuccessfulEnvironmentDecision | RejectedEnvironmentDecision;

export type ApplySubprocessEnv = (
  input?: ApplySubprocessEnvInput,
) => EnvironmentDecision;
