import { dispatchWorkflow, type DispatchEnv } from "./dispatch.ts";
import { serveImage } from "./report-image.ts";
import { handleReport, type ReportEnv } from "./report.ts";

interface Env extends ReportEnv, DispatchEnv {}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await dispatchWorkflow(env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/report") return handleReport(request, env);
    return (
      (await serveImage(request, env.REPORT_IMAGES)) ?? new Response("Not found", { status: 404 })
    );
  },
};
