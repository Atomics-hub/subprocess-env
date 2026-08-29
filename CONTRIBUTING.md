# Contributing

Thanks for helping make subprocess boundaries easier to reason about.

## Development

Requirements:

- Node.js 18+ for the runtime package;
- Node.js 24 for the complete contributor toolchain.

```bash
npm ci
npm run verify
```

## Policy changes

Every new or changed runtime-control rule must include:

- exact platform scope;
- affected runtime or tool;
- category and source scope (`all` or `overlay`);
- a concrete reason describing behavior, not a generic risk label;
- a primary documentation, source, issue, pull request, or advisory URL;
- a deterministic regression fixture that fails without the rule.

Product secrets do not belong in the generic corpus. They are handled through exact `delegateSecrets` configuration. Prefix rules require evidence that the entire prefix is a documented control namespace.

`scope: "all"` is reserved for variables that can load code, startup files, runtime options, or resolution paths when inherited. Controls that are dangerous specifically when supplied by an untrusted overlay use `scope: "overlay"` so compatible parent environments are not broken unnecessarily.

## Pull requests

- Keep the zero-runtime-dependency contract.
- Preserve ESM, CommonJS, Node 18+, Windows key identity, and null-prototype output.
- Never add a flattened-record convenience overload.
- Never put environment values in receipts, errors, or diagnostics.
- Document user-visible changes in `CHANGELOG.md`.
- Add a focused regression test that fails without the change.
- Keep marketing within the boundary documented in `SECURITY.md`.

By participating, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
