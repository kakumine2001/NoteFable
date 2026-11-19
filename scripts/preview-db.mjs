#!/usr/bin/env node
// Gives one git branch its own database for its Vercel Preview deployments.
//
//   npm run preview:db -- create [git-branch]   Neon branch + branch-scoped DATABASE_URL on Vercel, then redeploy
//   npm run preview:db -- delete [git-branch]   remove both again
//   npm run preview:db -- list                  Neon branches made by this script
//
// The git branch defaults to the current one. The Neon branch is a copy of the
// production branch named `preview/<git branch, "/" -> "-">`; the Vercel variable
// is `DATABASE_URL` for Preview limited to that git branch, which wins over the
// shared Preview value. `npm run git:cleanup` deletes both when the branch is merged.
//
// Needs NEON_API_KEY (env or the main checkout's .env.local) and a logged-in Vercel CLI.
// Never touches a Neon branch whose name does not start with `preview/`.
// See docs/architecture/deployment.md, "Preview 数据库".

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NEON_API = "https://console.neon.tech/api/v2";
const NEON_PROJECT_NAME = "neon_db";
const VERCEL_SCOPE = "kaku10";
const VERCEL_PROJECT = "notefable";
const PREFIX = "preview/";

const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// On Windows the CLI is vercel.cmd, which needs a shell; arguments here are names only,
// and secret values go through stdin so `&` in a connection string never reaches cmd.
const vercel = (args, input) =>
  execFileSync("vercel", [...args, "--scope", VERCEL_SCOPE, "--non-interactive"], {
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  }).trim();

export const neonBranchName = (gitBranch) => PREFIX + gitBranch.replace(/\//g, "-");

function readEnvFile(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1] === key) return match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

// NEON_API_KEY from the environment, else from .env.local of this worktree or of the main checkout.
export function neonApiKey() {
  if (process.env.NEON_API_KEY) return process.env.NEON_API_KEY;
  const roots = [git(["rev-parse", "--show-toplevel"])];
  const main = git(["worktree", "list", "--porcelain"]).split("\n")[0]?.replace(/^worktree /, "");
  if (main) roots.push(main);
  for (const root of roots) {
    const key = readEnvFile(path.join(root, ".env.local"), "NEON_API_KEY");
    if (key) return key;
  }
  return undefined;
}

async function neon(key, method, url, body) {
  const res = await fetch(NEON_API + url, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon ${method} ${url.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function findProject(key) {
  const search = `/projects?search=${encodeURIComponent(NEON_PROJECT_NAME)}`;
  const direct = await neon(key, "GET", search).catch(() => ({ projects: [] }));
  let project = direct.projects?.find((p) => p.name === NEON_PROJECT_NAME);
  if (!project) {
    // A personal API key lists an organization's projects only with org_id.
    const { organizations = [] } = await neon(key, "GET", "/users/me/organizations");
    for (const org of organizations) {
      const { projects = [] } = await neon(key, "GET", `${search}&org_id=${org.id}`);
      project = projects.find((p) => p.name === NEON_PROJECT_NAME);
      if (project) break;
    }
  }
  if (!project) throw new Error(`Neon project ${NEON_PROJECT_NAME} not found for this API key`);
  return project.id;
}

const listBranches = async (key, projectId) => (await neon(key, "GET", `/projects/${projectId}/branches`)).branches ?? [];

// Neon branches this script made (name starts with preview/), for git:cleanup.
export async function listPreviewBranches(key) {
  const projectId = await findProject(key);
  return { projectId, branches: (await listBranches(key, projectId)).filter((b) => b.name.startsWith(PREFIX)) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(key, projectId, branchId) {
  for (let i = 0; i < 60; i++) {
    const { branch } = await neon(key, "GET", `/projects/${projectId}/branches/${branchId}`);
    if (branch.current_state === "ready") return;
    await sleep(2000);
  }
  throw new Error("Neon branch did not become ready in 2 minutes");
}

export function setVercelDatabaseUrl(gitBranch, uri) {
  // Replace any earlier branch-scoped value; the shared Preview value is left alone.
  try {
    vercel(["env", "rm", "DATABASE_URL", "preview", gitBranch, "--project", VERCEL_PROJECT, "--yes"]);
  } catch {
    // none yet
  }
  vercel(["env", "add", "DATABASE_URL", "preview", gitBranch, "--project", VERCEL_PROJECT, "--sensitive", "--yes"], uri);
}

export function removeVercelDatabaseUrl(gitBranch) {
  try {
    vercel(["env", "rm", "DATABASE_URL", "preview", gitBranch, "--project", VERCEL_PROJECT, "--yes"]);
    return true;
  } catch {
    return false;
  }
}

export function redeployLatest(gitBranch) {
  const out = vercel(["list", VERCEL_PROJECT, "-m", `githubCommitRef=${gitBranch}`]);
  const url = out.split(/\s+/).find((w) => /^https:\/\/\S+\.vercel\.app$/.test(w));
  if (!url) return null;
  vercel(["redeploy", url, "--no-wait"]);
  return url;
}

async function create(key, gitBranch) {
  const projectId = await findProject(key);
  const name = neonBranchName(gitBranch);
  const branches = await listBranches(key, projectId);
  let branch = branches.find((b) => b.name === name);
  if (branch) {
    console.log(`Neon branch ${name} already exists, reusing it`);
  } else {
    const parent = branches.find((b) => b.default);
    if (!parent) throw new Error("Neon project has no default (production) branch");
    ({ branch } = await neon(key, "POST", `/projects/${projectId}/branches`, {
      branch: { name, parent_id: parent.id },
      endpoints: [{ type: "read_write", autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 0.5 }],
    }));
    console.log(`Created Neon branch ${name} from ${parent.name}`);
  }
  await waitReady(key, projectId, branch.id);
  const query = new URLSearchParams({ branch_id: branch.id, database_name: "neondb", role_name: "neondb_owner", pooled: "true" });
  const { uri } = await neon(key, "GET", `/projects/${projectId}/connection_uri?${query}`);
  setVercelDatabaseUrl(gitBranch, uri);
  console.log(`Set Vercel Preview DATABASE_URL for git branch ${gitBranch}`);
  const redeployed = redeployLatest(gitBranch);
  console.log(redeployed ? `Redeploying ${redeployed}` : "No deployment for this branch yet; the next push will use the new database");
}

async function remove(key, gitBranch) {
  const projectId = await findProject(key);
  const name = neonBranchName(gitBranch);
  const branch = (await listBranches(key, projectId)).find((b) => b.name === name);
  if (branch && !branch.default && !branch.protected) {
    await neon(key, "DELETE", `/projects/${projectId}/branches/${branch.id}`);
    console.log(`Deleted Neon branch ${name}`);
  } else {
    console.log(`No Neon branch ${name}`);
  }
  console.log(removeVercelDatabaseUrl(gitBranch) ? `Removed Vercel DATABASE_URL for ${gitBranch}` : `No Vercel DATABASE_URL for ${gitBranch}`);
}

export async function deletePreviewBranch(key, projectId, branchId) {
  await neon(key, "DELETE", `/projects/${projectId}/branches/${branchId}`);
}

async function main() {
  const [command, branchArg] = process.argv.slice(2);
  const key = neonApiKey();
  if (!key) {
    console.error("NEON_API_KEY is not set (env or .env.local of the main checkout). Create one in Neon: Account settings -> API keys.");
    process.exit(1);
  }
  if (command === "list") {
    const { branches } = await listPreviewBranches(key);
    for (const b of branches) console.log(`${b.name}  (created ${b.created_at})`);
    if (!branches.length) console.log("No preview/ branches");
    return;
  }
  const gitBranch = branchArg || git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!gitBranch || gitBranch === "HEAD" || gitBranch === "main") {
    console.error("Give a feature branch name (main and detached HEAD have no preview database).");
    process.exit(1);
  }
  if (command === "create") await create(key, gitBranch);
  else if (command === "delete") await remove(key, gitBranch);
  else {
    console.error("Usage: npm run preview:db -- <create|delete|list> [git-branch]");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
