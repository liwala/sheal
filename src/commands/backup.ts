import { mkdirSync, copyFileSync, readdirSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import chalk from "chalk";
import { getShealHomeDir } from "../learn/index.js";
import { readGlobalConfig, writeGlobalConfig } from "../learn/remote-config.js";
import { isGitRepo, initRepo, addRemote, removeRemote, getRemoteUrl, commitAll, push, pull, lastCommitInfo } from "../learn/git.js";
import { listAllNativeProjects } from "../entire/claude-native.js";

// ── Remote management ───────────────────────────────────────────────

export async function runBackupRemoteAdd(opts: { url: string }): Promise<void> {
  const dir = getShealHomeDir();

  // Migration: if old repo exists at ~/.sheal/learnings/.git, move it up
  const oldGit = join(dir, "learnings", ".git");
  if (existsSync(oldGit) && !(await isGitRepo(dir))) {
    console.log(chalk.gray("Migrating git repo from ~/.sheal/learnings/ to ~/.sheal/..."));
    renameSync(oldGit, join(dir, ".git"));
    // Remove old .gitignore from learnings/
    const oldIgnore = join(dir, "learnings", ".gitignore");
    if (existsSync(oldIgnore)) {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(oldIgnore);
    }
  }

  if (!(await isGitRepo(dir))) {
    console.log(chalk.gray("Initializing git repo in ~/.sheal/..."));
    await initRepo(dir);
  }

  await addRemote(dir, opts.url);

  const config = readGlobalConfig();
  config.remote = { url: opts.url };
  writeGlobalConfig(config);

  console.log(chalk.green(`Remote set to ${opts.url}`));
  console.log(chalk.gray(`Run 'sheal backup push' to push your data.`));
}

export async function runBackupRemoteShow(): Promise<void> {
  const dir = getShealHomeDir();
  const config = readGlobalConfig();
  const isRepo = await isGitRepo(dir);

  if (!config.remote?.url) {
    console.log(chalk.yellow("No remote configured."));
    console.log(chalk.gray("Run: sheal backup remote add <git-url>"));
    return;
  }

  console.log(`${chalk.bold("Remote:")}  ${config.remote.url}`);
  console.log(`${chalk.bold("Git:")}     ${isRepo ? chalk.green("initialized") : chalk.red("not initialized")}`);
  console.log(`${chalk.bold("Dir:")}     ${dir}`);

  if (isRepo) {
    const last = await lastCommitInfo(dir);
    if (last) {
      console.log(`${chalk.bold("Last:")}    ${last}`);
    }
  }
}

export async function runBackupRemoteRemove(): Promise<void> {
  const dir = getShealHomeDir();

  if (await isGitRepo(dir)) {
    const url = await getRemoteUrl(dir);
    if (url) {
      await removeRemote(dir);
    }
  }

  const config = readGlobalConfig();
  delete config.remote;
  writeGlobalConfig(config);

  console.log(chalk.green("Remote disconnected."));
  console.log(chalk.gray("The git repo is preserved — only the remote link was removed."));
}

// ── Push / Pull ─────────────────────────────────────────────────────

export async function runBackupPush(opts: { includeRetros?: boolean } = {}): Promise<void> {
  const dir = getShealHomeDir();
  const config = readGlobalConfig();

  if (!config.remote?.url) {
    console.log(chalk.red("No remote configured."));
    console.log(chalk.gray("Run: sheal backup remote add <git-url>"));
    return;
  }

  if (!(await isGitRepo(dir))) {
    console.log(chalk.red("~/.sheal/ is not a git repo."));
    console.log(chalk.gray("Run: sheal backup remote add <git-url>"));
    return;
  }

  if (opts.includeRetros) {
    const result = aggregateRetros(dir);
    if (result.files > 0) {
      console.log(chalk.gray(`Aggregated ${result.files} retro(s) from ${result.projects} project(s).`));
    }
  }

  const commit = await commitAll(dir);
  if (commit.committed) {
    console.log(chalk.gray(`Committed: ${commit.summary.split("\n")[0]}`));
  } else {
    console.log(chalk.gray(commit.summary));
  }

  console.log(chalk.gray(`Pushing to ${config.remote.url}...`));
  const result = await push(dir);

  if (result.ok) {
    console.log(chalk.green("Pushed successfully."));
  } else {
    console.log(chalk.red("Push failed:"));
    console.log(chalk.gray(result.output));
  }
}

export async function runBackupPull(): Promise<void> {
  const dir = getShealHomeDir();
  const config = readGlobalConfig();

  if (!config.remote?.url) {
    console.log(chalk.red("No remote configured."));
    console.log(chalk.gray("Run: sheal backup remote add <git-url>"));
    return;
  }

  if (!(await isGitRepo(dir))) {
    console.log(chalk.red("~/.sheal/ is not a git repo."));
    console.log(chalk.gray("Run: sheal backup remote add <git-url>"));
    return;
  }

  // Auto-commit local changes before pulling
  const commit = await commitAll(dir);
  if (commit.committed) {
    console.log(chalk.gray(`Auto-committed local changes: ${commit.summary.split("\n")[0]}`));
  }

  console.log(chalk.gray(`Pulling from ${config.remote.url}...`));
  const result = await pull(dir);

  if (result.ok) {
    console.log(chalk.green("Pulled successfully."));
  } else if (result.conflicts.length > 0) {
    console.log(chalk.red(`Merge conflicts in ${result.conflicts.length} file(s):`));
    for (const f of result.conflicts) {
      console.log(chalk.red(`  ${f}`));
    }
    console.log(chalk.yellow(`\nResolve conflicts in ${dir} then run 'sheal backup push'.`));
  } else {
    console.log(chalk.red("Pull failed:"));
    console.log(chalk.gray(result.output));
  }
}

// ── Retro aggregation ───────────────────────────────────────────────

function aggregateRetros(shealHome: string): { projects: number; files: number } {
  const retrosDir = join(shealHome, "retros");
  let projects = 0;
  let files = 0;

  try {
    const allProjects = listAllNativeProjects();

    for (const project of allProjects) {
      const projectRetros = join(project.projectPath, ".sheal", "retros");
      if (!existsSync(projectRetros)) continue;

      const retroFiles = readdirSync(projectRetros).filter((f) => f.endsWith(".md") || f.endsWith(".json"));
      if (retroFiles.length === 0) continue;

      // Use project name as subdirectory, slugified for safety
      const slug = basename(project.projectPath).replace(/[^a-zA-Z0-9_-]/g, "-");
      const destDir = join(retrosDir, slug);
      mkdirSync(destDir, { recursive: true });

      let projectCopied = 0;
      for (const file of retroFiles) {
        const src = join(projectRetros, file);
        const dest = join(destDir, file);

        // Skip if already synced with same content
        if (existsSync(dest) && readFileSync(src, "utf-8") === readFileSync(dest, "utf-8")) {
          continue;
        }

        copyFileSync(src, dest);
        projectCopied++;
      }

      if (projectCopied > 0) {
        projects++;
        files += projectCopied;
      }
    }
  } catch {
    // listAllNativeProjects may fail if no projects exist — that's fine
  }

  return { projects, files };
}
