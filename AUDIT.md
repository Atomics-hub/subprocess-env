# Audit record

## 2026-08-29 pre-release audit

Reviewed surfaces:

- provenance preservation and deny-by-default overlays;
- all-source runtime controls and overlay-only control selectors;
- Windows case-insensitive aliases;
- inherited secret delegation;
- getters, proxies, class instances, arrays, prototype keys, invalid names, non-string values, and NUL bytes;
- entry, key, value, total-byte, and receipt-key bounds;
- empty output on structural or budget rejection;
- value-free receipts and diagnostics;
- real Node child-process behavior;
- deterministic generated inputs and source immutability;
- ESM, CommonJS, TypeScript, JSON subpath, tarball contents, package size, and release metadata.

The package deliberately makes no sandbox, shell-safety, executable-integrity, filesystem, network, or process-tree guarantees. Those are separate boundaries.

Release evidence is produced by `npm run verify`; CI repeats the suite across supported Node releases and runs the complete audit job on Node 24.
