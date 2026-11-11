import { AsyncLocalStorage } from "node:async_hooks";

interface HubContext {
  env: Env;
  ctx: ExecutionContext;
}

const storage = new AsyncLocalStorage<HubContext>();

/** Bind Worker env for the lifetime of one fetch or scheduled invocation. */
export function runWithContext<T>(env: Env, ctx: ExecutionContext, fn: () => T): T {
  return storage.run({ env, ctx }, fn);
}

export function currentEnv(): Env | undefined {
  return storage.getStore()?.env;
}

/**
 * Schedule work that must finish after the response, or after the main
 * scheduled task. Outside a Worker (the agent:key script) the promise is
 * still observed so a rejection is not lost.
 */
export function waitUntil(promise: Promise<unknown>): void {
  const ctx = storage.getStore()?.ctx;
  const tracked = promise.catch((error: unknown) => {
    console.error(
      JSON.stringify({
        message: "background task failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  if (ctx) ctx.waitUntil(tracked);
}
