/**
 * CLAPP-003 fixture: "spill-app" — emits 2 KiB of output to prove the
 * output-size budget: capture is capped at budget.maxBytes, `truncated` is
 * set, and the overrun is reported as budget-exceeded/output-size.
 */
export {};

process.stdout.write('A'.repeat(2048));

// Stay alive briefly so the write is observable before any exit handling.
await Bun.sleep(250);
