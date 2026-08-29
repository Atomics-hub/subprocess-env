import corpus from "../data/runtime-controls.json" with { type: "json" };
import type { RuntimeControlRule } from "./types.js";

interface RuleCorpus {
  readonly policyVersion: string;
  readonly rules: readonly RuntimeControlRule[];
}

const typedCorpus = corpus as RuleCorpus;

export const policyVersion = typedCorpus.policyVersion;
export const runtimeControlRules: readonly RuntimeControlRule[] = Object.freeze(
  typedCorpus.rules.map((rule) =>
    Object.freeze({
      ...rule,
      platforms: Object.freeze([...rule.platforms]),
      runtimes: Object.freeze([...rule.runtimes]),
      evidence: Object.freeze([...rule.evidence]),
    }),
  ),
);

const appliesToPlatform = (
  rule: RuntimeControlRule,
  platform: string,
): boolean =>
  rule.platforms.includes("all") || rule.platforms.includes(platform);

interface RuleIndex {
  readonly exact: ReadonlyMap<string, RuntimeControlRule>;
  readonly prefixes: readonly (readonly [string, RuntimeControlRule])[];
}

const indexByPlatform = new Map<string, RuleIndex>();

const indexFor = (platform: string): RuleIndex => {
  const cached = indexByPlatform.get(platform);
  if (cached !== undefined) return cached;

  const exact = new Map<string, RuntimeControlRule>();
  const prefixes: (readonly [string, RuntimeControlRule])[] = [];
  for (const rule of runtimeControlRules) {
    if (!appliesToPlatform(rule, platform)) continue;
    const name = platform === "win32" ? rule.name.toUpperCase() : rule.name;
    if (rule.match === "exact") {
      if (!exact.has(name)) exact.set(name, rule);
    } else {
      prefixes.push([name, rule]);
    }
  }
  const index = Object.freeze({
    exact,
    prefixes: Object.freeze(prefixes),
  });
  indexByPlatform.set(platform, index);
  return index;
};

export const findRuntimeControlRule = (
  key: string,
  platform: string,
): RuntimeControlRule | undefined => {
  const comparable = platform === "win32" ? key.toUpperCase() : key;
  const index = indexFor(platform);
  const exact = index.exact.get(comparable);
  if (exact !== undefined) return exact;
  return index.prefixes.find(([prefix]) => comparable.startsWith(prefix))?.[1];
};

export const getRuntimeControlRule = (
  key: string,
  platform: string = process.platform,
): RuntimeControlRule | undefined => findRuntimeControlRule(key, platform);
