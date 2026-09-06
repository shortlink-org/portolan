// What the forge-facing scripts share: which forge the CI is, how to talk to
// it, and what a failed request reads as.
//
// Where it is running is read off the CI's own variables, the same way
// vite.config.ts reads the build stamp. GitHub Actions hands over a token
// that can write to the repository the workflow belongs to; GitLab CI's job
// token cannot write notes or releases, so a project access token is expected
// as PORTOLAN_TOKEN. The token is carried as "" rather than refused here, so
// each script can say what it lacks in its own order.

/** The forge and its API, or the reason there is none. */
export function detectForge(env) {
  if (env.GITHUB_ACTIONS === "true" || env.GITHUB_REPOSITORY) {
    return {
      provider: "github",
      api: (env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, ""),
      repo: env.GITHUB_REPOSITORY,
      token: env.GITHUB_TOKEN ?? "",
    };
  }

  if (env.GITLAB_CI === "true" || env.CI_API_V4_URL) {
    return {
      provider: "gitlab",
      api: env.CI_API_V4_URL.replace(/\/$/, ""),
      project: env.CI_PROJECT_ID,
      token: env.PORTOLAN_TOKEN ?? "",
    };
  }

  return { reason: "not running under GitHub Actions or GitLab CI" };
}

/** The headers every request to that forge carries. */
export function headers(forge) {
  return forge.provider === "github"
    ? {
        authorization: `Bearer ${forge.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      }
    : { "private-token": forge.token };
}

/** The project's API root: `/repos/{owner}/{repo}` or `/projects/{id}`. */
export function projectUrl(forge) {
  return forge.provider === "github"
    ? `${forge.api}/repos/${forge.repo}`
    : `${forge.api}/projects/${encodeURIComponent(forge.project)}`;
}

/** Whether the forge would not let this token do that: a policy, not a bug. */
export function refused(res) {
  return res.status === 401 || res.status === 403;
}

export async function failure(what, res) {
  const text = await res.text().catch(() => "");

  return new Error(`${what}: ${res.status} ${res.statusText}${text ? " - " + text.slice(0, 200) : ""}`);
}
