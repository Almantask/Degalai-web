interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  GITHUB_REF: string;
}

/** Starts the data pipeline + deploy workflow via workflow_dispatch. */
async function dispatchWorkflow(env: Env): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "kur-degalai-cron",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });
  if (!res.ok) {
    // Throwing marks the cron invocation as failed in the Cloudflare dashboard.
    throw new Error(`workflow_dispatch failed: ${res.status} ${await res.text()}`);
  }
  console.log(`Dispatched ${env.GITHUB_WORKFLOW} on ${env.GITHUB_REPO}@${env.GITHUB_REF}`);
}

export default {
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await dispatchWorkflow(env);
  },
};
