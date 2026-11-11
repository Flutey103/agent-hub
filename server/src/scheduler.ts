import { db } from "./db.js";
import { env } from "./env.js";
import { startDueLoops } from "./loops.js";
import { runHeadlessAgents } from "./runner.js";

let ticking = false;

/**
 * Same work the Node process used to run on a timer: expire leases, start due
 * loops, then let each configured headless agent work one task.
 * Lease expiry is also scheduled in Postgres; expire_leases() is safe to run
 * from both places (row locks, skip locked).
 */
export async function tick(): Promise<void> {
  if (ticking) {
    console.log(JSON.stringify({ message: "scheduler tick skipped", reason: "already running in this isolate" }));
    return;
  }
  ticking = true;
  try {
    const { data: expired, error } = await db.rpc("expire_leases");
    if (error) throw new Error(error.message);
    if (expired) console.log(JSON.stringify({ message: "leases expired", count: expired }));
    await startDueLoops();
    if (env.runnerEnabled) await runHeadlessAgents();
    console.log(JSON.stringify({ message: "scheduler tick finished", runnerEnabled: env.runnerEnabled }));
  } catch (error) {
    console.error(JSON.stringify({ message: "scheduler tick failed", error: error instanceof Error ? error.message : String(error) }));
    throw error;
  } finally {
    ticking = false;
  }
}
