/**
 * CLAPP-003 fixture: "fail-app" — exits with a distinctive non-zero code (7)
 * to prove exit-code propagation through the executor.
 */
export {};

process.exit(7);
