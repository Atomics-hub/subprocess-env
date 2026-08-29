# Security policy

## Supported versions

The latest published minor version receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for a suspected bypass or sensitive corpus omission. Use GitHub private vulnerability reporting for `Atomics-hub/subprocess-env`:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include affected versions, platform and runtime, a minimal reproduction, impact, and any suggested mitigation.

We aim to acknowledge reports within 72 hours. Confirmed issues will receive a coordinated fix and advisory before public technical details are discussed.

## Security boundary

`subprocess-env` compiles environment records. It does not sandbox processes, approve commands, escape shells, verify executables, contain the filesystem or network, manage descendants, store secrets, or validate arguments.

The all-source runtime-control corpus is a curated defense against documented startup and loader behavior, not proof that every runtime control on every installed program has been enumerated. The `compatible` profile intentionally retains inherited keys outside known controls and undelegated secrets. Callers remain responsible for establishing the provenance of inherited state and for choosing an OS isolation boundary appropriate to untrusted code.

On a rejected decision, the package returns an empty environment. Callers must check `decision.ok` before spawning and must not fall back to `process.env` after a rejection.
