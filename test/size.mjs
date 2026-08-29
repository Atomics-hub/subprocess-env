import assert from "node:assert/strict";
import { stat } from "node:fs/promises";

const esm = await stat(new URL("../dist/index.js", import.meta.url));
const cjs = await stat(new URL("../dist/index.cjs", import.meta.url));
assert.ok(esm.size < 50_000, `ESM build is unexpectedly large: ${esm.size}`);
assert.ok(cjs.size < 50_000, `CJS build is unexpectedly large: ${cjs.size}`);
console.log(JSON.stringify({ esmBytes: esm.size, cjsBytes: cjs.size }));
