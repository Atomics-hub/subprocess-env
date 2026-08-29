import { findRuntimeControlRule } from "./rules.js";
import type {
  ApplySubprocessEnv,
  CompileSubprocessEnvOptions,
  DiagnosticCode,
  EnvironmentDiagnostic,
  EnvironmentInput,
  EnvironmentLimits,
  EnvironmentReceiptEntry,
  EnvironmentSource,
  ReceiptReason,
} from "./types.js";

const DEFAULT_LIMITS: EnvironmentLimits = Object.freeze({
  maxEntries: 4_096,
  maxKeyBytes: 256,
  maxValueBytes: 128 * 1_024,
  maxTotalBytes: 1_024 * 1_024,
});

const PORTABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_NAME =
  /(?:^|_)(?:API_?KEY|ACCESS_KEY|TOKEN|SECRET|PASSWORD|PASSCODE|PASSPHRASE|CREDENTIALS?|PRIVATE_KEY)(?:_|$)/i;
const RECEIPT_KEY_CHARACTERS = 128;

const BASELINE_BY_PLATFORM: Readonly<Record<string, readonly string[]>> = {
  default: ["COLORTERM", "LANG", "LC_ALL", "PATH", "TERM", "TZ"],
  win32: [
    "COLORTERM",
    "LANG",
    "PATH",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TERM",
    "TMP",
    "TZ",
    "WINDIR",
  ],
};

const nullEnvironment = (): Record<string, string> => Object.create(null);
const normalizeKey = (key: string, platform: string): string =>
  platform === "win32" ? key.toUpperCase() : key;
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

const boundedKey = (
  key: string,
): Pick<EnvironmentReceiptEntry, "key" | "keyTruncated"> =>
  key.length <= RECEIPT_KEY_CHARACTERS
    ? { key }
    : { key: key.slice(0, RECEIPT_KEY_CHARACTERS), keyTruncated: true };

const diagnostic = (
  code: DiagnosticCode,
  severity: "warning" | "error",
): EnvironmentDiagnostic => ({
  severity,
  code,
  reason: {
    "path-not-provided":
      "No PATH was produced. Node may apply a platform-specific command lookup fallback.",
    "invalid-source-record":
      "Environment sources must be plain or null-prototype records.",
    "environment-entry-budget-exceeded":
      "The combined environment entry limit was exceeded.",
    "environment-key-budget-exceeded":
      "An environment key exceeded the configured byte limit.",
    "environment-value-budget-exceeded":
      "An environment value exceeded the configured byte limit.",
    "environment-total-budget-exceeded":
      "The combined environment byte limit was exceeded.",
    "invalid-options":
      "Compiler options and policy-name lists must use the documented shapes.",
    "invalid-profile": "The requested environment profile is not supported.",
    "invalid-limit": "Environment limits must be non-negative finite integers.",
  }[code],
});

const rejected = (code: DiagnosticCode) => ({
  ok: false as const,
  env: nullEnvironment(),
  receipt: [
    {
      action: "rejected" as const,
      reason: "environment-rejected" as const,
    },
  ],
  diagnostics: [diagnostic(code, "error")],
});

const normalizeSet = (
  values: readonly string[] | undefined,
  platform: string,
): ReadonlySet<string> | undefined => {
  if (
    values !== undefined &&
    (!Array.isArray(values) ||
      !values.every(
        (value: unknown) =>
          typeof value === "string" && PORTABLE_NAME.test(value),
      ))
  ) {
    return undefined;
  }
  return new Set((values ?? []).map((value) => normalizeKey(value, platform)));
};

const validLimits = (limits: EnvironmentLimits): boolean =>
  Object.values(limits).every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );

type DescriptorEntry = readonly [string, PropertyDescriptor];

const descriptorsFor = (
  record: EnvironmentInput,
): readonly DescriptorEntry[] | undefined => {
  try {
    if (record === null || typeof record !== "object") return undefined;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    return Object.entries(Object.getOwnPropertyDescriptors(record)).filter(
      ([, descriptor]) => descriptor.enumerable === true,
    );
  } catch {
    return undefined;
  }
};

export const compileSubprocessEnv = (
  options: CompileSubprocessEnvOptions = {},
): ApplySubprocessEnv => {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    return () => rejected("invalid-options");
  }
  let platform: string;
  let profile: "untrusted" | "compatible";
  let limits: EnvironmentLimits;
  let allowInherited: ReadonlySet<string> | undefined;
  let allowOverlay: ReadonlySet<string> | undefined;
  let delegateSecrets: ReadonlySet<string> | undefined;
  let dangerousControls: ReadonlySet<string> | undefined;
  let baseline: ReadonlySet<string> | undefined;
  try {
    platform = options.platform ?? process.platform;
    profile = options.profile ?? "untrusted";
    limits = { ...DEFAULT_LIMITS, ...options.limits };
    allowInherited = normalizeSet(options.allowInherited, platform);
    allowOverlay = normalizeSet(options.allowOverlay, platform);
    delegateSecrets = normalizeSet(options.delegateSecrets, platform);
    dangerousControls = normalizeSet(
      options.dangerouslyAllowInheritedControls,
      platform,
    );
    baseline = normalizeSet(
      BASELINE_BY_PLATFORM[platform] ?? BASELINE_BY_PLATFORM.default,
      platform,
    );
  } catch {
    return () => rejected("invalid-options");
  }
  if (profile !== "untrusted" && profile !== "compatible") {
    return () => rejected("invalid-profile");
  }
  if (
    typeof platform !== "string" ||
    allowInherited === undefined ||
    allowOverlay === undefined ||
    delegateSecrets === undefined ||
    dangerousControls === undefined ||
    baseline === undefined
  ) {
    return () => rejected("invalid-options");
  }

  return (input = {}) => {
    if (!validLimits(limits)) return rejected("invalid-limit");

    let inherited: EnvironmentInput;
    let overlay: EnvironmentInput;
    try {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return rejected("invalid-source-record");
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) {
        return rejected("invalid-source-record");
      }
      inherited = input.inherited ?? {};
      overlay = input.overlay ?? {};
    } catch {
      return rejected("invalid-source-record");
    }
    const inheritedEntries = descriptorsFor(inherited);
    const overlayEntries = descriptorsFor(overlay);
    if (inheritedEntries === undefined || overlayEntries === undefined) {
      return rejected("invalid-source-record");
    }

    const entryCount = inheritedEntries.length + overlayEntries.length;
    if (entryCount > limits.maxEntries) {
      return rejected("environment-entry-budget-exceeded");
    }

    let totalBytes = 0;
    for (const [, entries] of [
      ["inherited", inheritedEntries],
      ["overlay", overlayEntries],
    ] as const) {
      for (const [key, descriptor] of entries) {
        const keyBytes = byteLength(key);
        if (keyBytes > limits.maxKeyBytes) {
          return rejected("environment-key-budget-exceeded");
        }
        if ("value" in descriptor && typeof descriptor.value === "string") {
          const valueBytes = byteLength(descriptor.value);
          if (valueBytes > limits.maxValueBytes) {
            return rejected("environment-value-budget-exceeded");
          }
          totalBytes += keyBytes + valueBytes + 2;
          if (totalBytes > limits.maxTotalBytes) {
            return rejected("environment-total-budget-exceeded");
          }
        }
      }
    }

    const env = nullEnvironment();
    const receipt: EnvironmentReceiptEntry[] = [];
    const outputKeyByIdentity = new Map<string, string>();

    const remove = (
      source: EnvironmentSource,
      key: string,
      reason: ReceiptReason,
      rule?: string,
    ): void => {
      receipt.push({
        ...boundedKey(key),
        source,
        action: "removed",
        reason,
        ...(rule === undefined ? {} : { rule }),
      });
    };

    const accept = (
      source: EnvironmentSource,
      key: string,
      value: string,
      reason: ReceiptReason,
    ): void => {
      const identity = normalizeKey(key, platform);
      const priorKey = outputKeyByIdentity.get(identity);
      if (priorKey !== undefined) delete env[priorKey];
      outputKeyByIdentity.set(identity, key);
      env[key] = value;
      receipt.push({
        ...boundedKey(key),
        source,
        action: priorKey === undefined ? "kept" : "replaced",
        reason:
          priorKey === undefined || source === "inherited"
            ? reason
            : "allowed-overlay-replacement",
      });
    };

    const visit = (
      source: EnvironmentSource,
      entries: readonly DescriptorEntry[],
    ): void => {
      for (const [key, descriptor] of entries) {
        if (!("value" in descriptor)) {
          remove(source, key, "accessor-entry");
          continue;
        }
        const value: unknown = descriptor.value;
        if (!PORTABLE_NAME.test(key) || key.includes("\0")) {
          remove(source, key, "invalid-name");
          continue;
        }
        if (typeof value !== "string" || value.includes("\0")) {
          remove(source, key, "invalid-value");
          continue;
        }

        const identity = normalizeKey(key, platform);
        const rule = findRuntimeControlRule(key, platform);
        if (rule?.scope === "all") {
          if (source === "inherited" && dangerousControls.has(identity)) {
            accept(source, key, value, "dangerously-allowed-inherited-control");
          } else {
            remove(source, key, "runtime-control", rule.name);
          }
          continue;
        }

        if (source === "overlay" && rule?.scope === "overlay") {
          remove(source, key, "untrusted-control-override", rule.name);
          continue;
        }

        if (source === "overlay") {
          if (!allowOverlay.has(identity)) {
            remove(source, key, "overlay-not-allowed");
            continue;
          }
          accept(source, key, value, "allowed-overlay");
          continue;
        }

        const secret = SECRET_NAME.test(key);
        if (secret && !delegateSecrets.has(identity)) {
          remove(source, key, "secret-not-delegated");
          continue;
        }
        if (secret) {
          accept(source, key, value, "delegated-secret");
          continue;
        }
        if (baseline.has(identity)) {
          accept(source, key, value, "baseline-inherited");
          continue;
        }
        if (allowInherited.has(identity)) {
          accept(source, key, value, "allowed-inherited");
          continue;
        }
        if (profile === "compatible") {
          accept(source, key, value, "compatible-inherited");
          continue;
        }
        remove(source, key, "inherited-not-allowed");
      }
    };

    visit("inherited", inheritedEntries);
    visit("overlay", overlayEntries);

    const diagnostics: EnvironmentDiagnostic[] = [];
    if (!outputKeyByIdentity.has(normalizeKey("PATH", platform))) {
      diagnostics.push(diagnostic("path-not-provided", "warning"));
    }
    return { ok: true as const, env, receipt, diagnostics };
  };
};
