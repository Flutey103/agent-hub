import { app } from "./app.js";
import { runWithContext } from "./context.js";
import { tick } from "./scheduler.js";

export default {
  async fetch(request, env, ctx) {
    return runWithContext(env, ctx, () => app.fetch(request, env, ctx));
  },
  async scheduled(controller, env, ctx) {
    console.log(
      JSON.stringify({
        message: "scheduler tick started",
        cron: controller.cron,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
      }),
    );
    await runWithContext(env, ctx, () => tick());
  },
} satisfies ExportedHandler<Env>;
