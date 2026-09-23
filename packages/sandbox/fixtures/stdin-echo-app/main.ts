/**
 * CLAPP-003 fixture: "stdin-echo-app" — reads stdin to EOF and writes it back
 * uppercased, proving ExecutionSpec.stdinData passthrough.
 */
export {};

const input = await Bun.stdin.text();

process.stdout.write(input.toUpperCase());
