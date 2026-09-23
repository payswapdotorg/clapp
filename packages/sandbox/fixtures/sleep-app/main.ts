/**
 * CLAPP-003 fixture: "sleep-app" — overruns any sane wall-clock budget.
 *
 * Prints its pid first so the test can prove the process was actually
 * killed, then sleeps for 60 seconds.
 */
export {};

console.log(JSON.stringify({ pid: process.pid }));

await Bun.sleep(60_000);
