/**
 * CLAPP-003 fixture: "term-proof-app" — traps SIGTERM so only the SIGKILL
 * escalation leg of the executor's kill ladder can stop it.
 */
export {};

console.log(JSON.stringify({ pid: process.pid }));

process.on('SIGTERM', () => {
  // Trapped: this fixture must be stopped by the SIGKILL escalation.
});

await Bun.sleep(60_000);
