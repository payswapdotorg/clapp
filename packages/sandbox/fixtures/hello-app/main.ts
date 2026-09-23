/**
 * CLAPP-003 fixture: "hello-app" — a stand-in generated application.
 *
 * Emits one JSON line proving the execution profile from inside the child:
 *   { pid, cwd, hasSecretEnv }
 * - `cwd` must equal the profile rootDir (cwd isolation proven from within).
 * - `hasSecretEnv` reports whether CLAPP_TEST_SECRET — planted in the parent
 *   env by the test — leaked through the sandbox env filter.
 *
 * Exits 0.
 */
export {};

const payload = {
  pid: process.pid,
  cwd: process.cwd(),
  hasSecretEnv: process.env['CLAPP_TEST_SECRET'] !== undefined,
};

console.log(JSON.stringify(payload));
