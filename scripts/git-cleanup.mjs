#!/usr/bin/env node
// Removes finished work: worktrees, local branches and origin branches that are
// already merged into origin/main, then fast-forwards the main checkout.
//
//   npm run git:cleanup              clean up
//   npm run git:cleanup -- --dry-run show what would be removed
//
// A branch counts as merged only when its tip is in origin/main but NOT on
// main's first-parent line, i.e. it was brought in by a merge commit (GitHub
// PR or local merge). A fresh branch cut from main sits on that line, so it is
// never touched. Anything with uncommitted changes is skipped and reported.

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const dryRun = process.argv.includes("--dry-run");
const DETACHED_IDLE_MS = 24 * 60 * 60 * 1000;

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}
function tryGit(args, opts) {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}
const skipped = [];
// Runs one removal; a failure is reported and the rest of the cleanup goes on.
function act(label, fn) {
  console.log(`${dryRun ? "[dry-run] " : ""}${label}`);
  if (dryRun) return true;
  try {
    fn();
    return true;
  } catch (error) {
    skipped.push(`${label}: failed (${String(error.stderr || error.message).trim().split("\n")[0]})`);
    return false;
  }
}
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

git(["fetch", "--prune", "origin"]);
const MAIN = "origin/main";
const firstParent = new Set(git(["rev-list", "--first-parent", MAIN]).split("\n"));
const isAncestor = (sha) => tryGit(["merge-base", "--is-ancestor", sha, MAIN]) !== null;
const isMerged = (sha) => isAncestor(sha) && !firstParent.has(sha);
const isDirty = (dir) => git(["-C", dir, "status", "--porcelain"]) !== "";

// Worktrees (the first entry is the main checkout and is never removed).
const worktrees = git(["worktree", "list", "--porcelain"])
  .split(/\n\n/)
  .map((block) => {
    const wt = {};
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      wt[key] = rest.join(" ") || true;
    }
    return wt;
  })
  .filter((wt) => wt.worktree);
const [mainCheckout, ...others] = worktrees;
const here = git(["rev-parse", "--show-toplevel"]);
const removedBranches = new Set();
// Explains a branch that is left alone because it is not merged by a merge commit.
function whyKept(name, sha) {
  if (!isAncestor(sha)) return `${name}: has commits not in main`;
  if (firstParent.has(sha)) return `${name}: no commits of its own (new, or fast-forwarded into main)`;
  return null;
}

for (const wt of others) {
  const dir = wt.worktree;
  if (!existsSync(dir)) continue; // handled by prune
  const branch = typeof wt.branch === "string" ? wt.branch.replace("refs/heads/", "") : null;
  const label = `${dir} (${branch ?? "detached"})`;
  const merged = branch
    ? isMerged(wt.HEAD)
    : isAncestor(wt.HEAD) && Date.now() - statSync(dir).mtimeMs > DETACHED_IDLE_MS;
  if (!merged) {
    if (branch) skipped.push(whyKept(label, wt.HEAD));
    continue;
  }
  if (samePath(dir, here)) {
    skipped.push(`${label}: merged, but this is the current directory; rerun from the main checkout`);
    continue;
  }
  if (isDirty(dir)) {
    skipped.push(`${label}: merged but has uncommitted changes`);
    continue;
  }
  if (act(`remove worktree ${dir}`, () => git(["worktree", "remove", dir])) && branch) {
    act(`delete branch ${branch}`, () => git(["branch", "-D", branch]));
    removedBranches.add(branch);
  }
}
if (!dryRun) git(["worktree", "prune"]);

// Local branches without a worktree.
const checkedOut = new Set(
  worktrees.filter((wt) => typeof wt.branch === "string").map((wt) => wt.branch.replace("refs/heads/", "")),
);
for (const line of git(["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"]).split("\n")) {
  const [branch, sha] = line.split(" ");
  if (!branch || branch === "main" || checkedOut.has(branch) || removedBranches.has(branch)) continue;
  if (isMerged(sha)) act(`delete branch ${branch}`, () => git(["branch", "-D", branch]));
  else skipped.push(whyKept(branch, sha));
}

// Branches on origin.
for (const line of git(["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/remotes/origin"]).split("\n")) {
  const [ref, sha] = line.split(" ");
  const branch = ref?.replace(/^origin\//, "");
  if (!branch || branch === "main" || branch === "HEAD" || ref === "origin") continue;
  if (!isMerged(sha)) {
    skipped.push(whyKept(`origin/${branch}`, sha));
  } else if (checkedOut.has(branch) && !removedBranches.has(branch)) {
    skipped.push(`origin/${branch}: merged, kept because its worktree was left in place`);
  } else {
    // The lease makes the push fail if someone pushed to the branch after our fetch.
    act(`delete origin/${branch}`, () =>
      git(["push", `--force-with-lease=refs/heads/${branch}:${sha}`, "origin", "--delete", branch]),
    );
  }
}

// Main checkout: fast-forward when it is on main and clean.
const mainDir = mainCheckout.worktree;
if (mainCheckout.branch === "refs/heads/main" && !isDirty(mainDir)) {
  if (git(["-C", mainDir, "rev-parse", "HEAD"]) !== git(["rev-parse", MAIN]))
    act(`fast-forward ${path.basename(mainDir)} to ${MAIN}`, () => git(["-C", mainDir, "merge", "--ff-only", MAIN]));
} else {
  skipped.push(`${mainDir}: not a clean main checkout, not fast-forwarded`);
}

if (skipped.length) {
  console.log("\nLeft in place:");
  for (const s of skipped) console.log(`  ${s}`);
}
