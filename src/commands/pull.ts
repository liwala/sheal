import { availableSandboxAdapters } from "../pull/registry.js";
import { createPullStage, defaultPullStagingRoot, gcPullStages, writePullCheckpoint, writePullProvenance } from "../pull/stage.js";
import { loadConfig } from "../config/loader.js";
import { normalizePullStage } from "../sessions/raw-registry.js";
import type { PullCheckpointTarget } from "../config/types.js";
import type { PullResult, SandboxAdapter, SandboxInstance } from "../pull/types.js";

export interface PullOptions {
  list?: boolean;
  all?: boolean;
  gc?: boolean;
  checkpoint?: boolean;
  checkpointRun?: boolean;
  format?: string;
}

interface BackendListing {
  backend: string;
  sandboxes: SandboxInstance[];
}

export async function runPull(backend: string | undefined, name: string | undefined, opts: PullOptions): Promise<void> {
  const config = loadConfig(process.cwd());

  if (opts.checkpointRun) {
    if (opts.all) {
      console.error("Use --checkpoint-run without --all; configure pull.checkpointTargets instead.");
      process.exitCode = 1;
      return;
    }
    if (opts.list || opts.gc || opts.checkpoint || backend || name) {
      console.error("Use --checkpoint-run by itself; configure pull.checkpointTargets for the local runtimes to checkpoint.");
      process.exitCode = 1;
      return;
    }
    await runCheckpointRun({
      format: opts.format ?? "pretty",
      stagingRoot: config.pull.stagingDir ?? undefined,
      targets: config.pull.checkpointTargets,
    });
    return;
  }

  if (opts.gc) {
    if (opts.checkpoint) {
      console.error("Use --checkpoint with `sheal pull <backend> <name>`, not with --gc.");
      process.exitCode = 1;
      return;
    }
    runPullGc({
      format: opts.format ?? "pretty",
      stagingRoot: config.pull.stagingDir ?? defaultPullStagingRoot(),
      retentionDays: config.pull.stagingRetentionDays,
    });
    return;
  }

  if (opts.list) {
    if (opts.checkpoint) {
      console.error("Use --checkpoint with `sheal pull <backend> <name>`, not with --list.");
      process.exitCode = 1;
      return;
    }
    await runPullList({ format: opts.format ?? "pretty" });
    return;
  }

  if (opts.all) {
    if (opts.checkpoint) {
      if (backend === "docker") {
        console.error("sheal pull docker --all --checkpoint is not supported; use pull.checkpointTargets with `sheal pull --checkpoint-run` for selected containers.");
        process.exitCode = 1;
        return;
      }
      if (!backend) {
        console.error("Use `sheal pull sbx --all --checkpoint` with an explicitly allowed backend.");
        process.exitCode = 1;
        return;
      }
      if (!config.pull.checkpointAllowAllBackends.includes(backend)) {
        console.error(`Set pull.checkpointAllowAllBackends to include "${backend}" before using \`sheal pull ${backend} --all --checkpoint\`.`);
        process.exitCode = 1;
        return;
      }
    }
    await runPullAll(backend, name, {
      format: opts.format ?? "pretty",
      stagingRoot: config.pull.stagingDir ?? undefined,
      projectRoot: process.cwd(),
      checkpoint: opts.checkpoint === true,
    });
    return;
  }

  if (backend && name) {
    const adapters = await availableSandboxAdapters();
    const adapter = adapters.find((item) => item.type === backend);
    if (!adapter) {
      console.error(`Sandbox backend "${backend}" is not available. Run \`sheal pull --list\` to discover sandboxes.`);
      process.exitCode = 1;
      return;
    }

    const sandboxes = await adapter.listInstances();
    if (!sandboxes.some((sandbox) => sandbox.name === name)) {
      console.error(`Sandbox "${name}" was not found for backend "${backend}". Run \`sheal pull --list\` to discover sandboxes.`);
      process.exitCode = 1;
      return;
    }

    const stage = createPullStage({
      stagingRoot: config.pull.stagingDir ?? undefined,
      backend,
      name,
    });
    const result = await adapter.pull(name, stage.dir, { pulledAt: stage.pulledAt });
    if (opts.checkpoint) {
      const checkpointResult = writeCheckpointStage({ backend, name, stage, result });
      printPullResult({ backend, name, stagingDir: stage.dir, result: checkpointResult, format: opts.format ?? "pretty", checkpoint: true });
      return;
    }

    writePullProvenance(stage.dir, result.provenance);
    normalizePullStage({
      projectRoot: process.cwd(),
      pullDir: stage.dir,
      backend,
      name,
    });
    printPullResult({ backend, name, stagingDir: stage.dir, result, format: opts.format ?? "pretty" });
    return;
  }

  console.error("Specify --list, or use `sheal pull <backend> <name>`.");
  process.exitCode = 1;
}

async function runCheckpointRun(opts: {
  format: string;
  stagingRoot?: string;
  targets: PullCheckpointTarget[];
}): Promise<void> {
  const adapters = await availableSandboxAdapters();
  let checkpointed = 0;
  let failed = 0;
  const results: PullCommandResult[] = [];
  const failures: Array<{ backend: string; name: string; error: string }> = [];

  for (const target of opts.targets) {
    const adapter = adapters.find((item) => item.type === target.backend);
    if (!adapter) {
      failed += 1;
      failures.push({
        backend: target.backend,
        name: target.name,
        error: `Sandbox backend "${target.backend}" is not available.`,
      });
      continue;
    }

    try {
      const result = await checkpointTarget({
        adapter,
        backend: target.backend,
        name: target.name,
        stagingRoot: opts.stagingRoot,
      });
      checkpointed += 1;
      results.push(result);
      if (opts.format !== "json") {
        printPullCommandResult(result, opts.format);
      }
    } catch (error) {
      failed += 1;
      failures.push({
        backend: target.backend,
        name: target.name,
        error: formatError(error),
      });
    }
  }

  if (opts.format === "json") {
    console.log(JSON.stringify({ checkpointed, failed, results, failures }, null, 2));
  } else {
    console.log(`Summary: checkpointed ${checkpointed}, failed ${failed}`);
    for (const failure of failures) {
      console.error(`Failed ${failure.backend}/${failure.name}: ${failure.error}`);
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function checkpointTarget(params: {
  adapter: SandboxAdapter;
  backend: string;
  name: string;
  stagingRoot?: string;
}): Promise<PullCommandResult> {
  const stage = createPullStage({
    stagingRoot: params.stagingRoot,
    backend: params.backend,
    name: params.name,
  });
  const result = await params.adapter.pull(params.name, stage.dir, { pulledAt: stage.pulledAt });
  const checkpointResult = writeCheckpointStage({
    backend: params.backend,
    name: params.name,
    stage,
    result,
  });

  return buildPullCommandResult({
    backend: params.backend,
    name: params.name,
    stagingDir: stage.dir,
    result: checkpointResult,
    checkpoint: true,
  });
}

function writeCheckpointStage(params: {
  backend: string;
  name: string;
  stage: { dir: string; pulledAt: string };
  result: PullResult;
}): PullResult {
  const checkpointResult: PullResult = {
    ...params.result,
    provenance: { ...params.result.provenance, captureKind: "checkpoint" },
  };
  writePullCheckpoint(params.stage.dir, {
    backend: params.backend,
    name: params.name,
    capturedAt: params.stage.pulledAt,
  });
  writePullProvenance(params.stage.dir, checkpointResult.provenance);
  return checkpointResult;
}

function runPullGc(opts: { format: string; stagingRoot: string; retentionDays: number | null }): void {
  const result = gcPullStages({
    stagingRoot: opts.stagingRoot,
    retentionDays: opts.retentionDays,
  });

  if (opts.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.enabled) {
    console.log("Pull staging retention is disabled. Set pull.stagingRetentionDays to enable GC.");
    return;
  }

  console.log(`Removed ${result.removed.length} expired pull staging director${result.removed.length === 1 ? "y" : "ies"}.`);
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} unrecognized staging director${result.skipped.length === 1 ? "y" : "ies"}.`);
  }
}

async function runPullAll(
  backend: string | undefined,
  name: string | undefined,
  opts: { format: string; stagingRoot?: string; projectRoot: string; checkpoint?: boolean },
): Promise<void> {
  if (!backend || name) {
    console.error(`Use \`sheal pull sbx --all${opts.checkpoint ? " --checkpoint" : ""}\` to ${opts.checkpoint ? "checkpoint" : "pull"} every sbx sandbox.`);
    process.exitCode = 1;
    return;
  }

  if (backend === "docker") {
    console.error(opts.checkpoint
      ? "sheal pull docker --all --checkpoint is not supported; use pull.checkpointTargets with `sheal pull --checkpoint-run` for selected containers."
      : "sheal pull docker --all is not supported; use `sheal pull --list` and then `sheal pull docker <container>`.");
    process.exitCode = 1;
    return;
  }

  const adapters = await availableSandboxAdapters();
  const adapter = adapters.find((item) => item.type === backend);
  if (!adapter) {
    console.error(`Sandbox backend "${backend}" is not available. Run \`sheal pull --list\` to discover sandboxes.`);
    process.exitCode = 1;
    return;
  }

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  const results: PullCommandResult[] = [];
  const skippedSandboxes: Array<{ backend: string; name: string; reason: string }> = [];
  const failures: Array<{ backend: string; name: string; error: string }> = [];

  for (const sandbox of await adapter.listInstances()) {
    if (!hasAvailableWorkspace(sandbox)) {
      skipped += 1;
      skippedSandboxes.push({ backend, name: sandbox.name, reason: "missing workspace" });
      if (opts.format !== "json") {
        console.log(`Skipped ${backend}/${sandbox.name}: missing workspace`);
      }
      continue;
    }

    try {
      const commandResult = opts.checkpoint
        ? await checkpointTarget({ adapter, backend, name: sandbox.name, stagingRoot: opts.stagingRoot })
        : await pullTarget({ adapter, backend, name: sandbox.name, stagingRoot: opts.stagingRoot, projectRoot: opts.projectRoot });
      completed += 1;
      results.push(commandResult);
      if (opts.format !== "json") {
        printPullCommandResult(commandResult, opts.format);
      }
    } catch (error) {
      failed += 1;
      failures.push({ backend, name: sandbox.name, error: formatError(error) });
      if (opts.format !== "json") {
        console.error(`Failed ${backend}/${sandbox.name}: ${formatError(error)}`);
      }
    }
  }

  if (opts.format === "json") {
    const output = opts.checkpoint
      ? { checkpointed: completed, skipped, failed, results, skippedSandboxes, failures }
      : { pulled: completed, skipped, failed, results, skippedSandboxes, failures };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Summary: ${opts.checkpoint ? "checkpointed" : "pulled"} ${completed}, skipped ${skipped}, failed ${failed}`);
  }
  if (completed === 0 && failed > 0) {
    process.exitCode = 1;
  }
}

async function pullTarget(params: {
  adapter: SandboxAdapter;
  backend: string;
  name: string;
  stagingRoot?: string;
  projectRoot: string;
}): Promise<PullCommandResult> {
  const stage = createPullStage({ stagingRoot: params.stagingRoot, backend: params.backend, name: params.name });
  const result = await params.adapter.pull(params.name, stage.dir, { pulledAt: stage.pulledAt });
  writePullProvenance(stage.dir, result.provenance);
  normalizePullStage({
    projectRoot: params.projectRoot,
    pullDir: stage.dir,
    backend: params.backend,
    name: params.name,
  });
  return buildPullCommandResult({
    backend: params.backend,
    name: params.name,
    stagingDir: stage.dir,
    result,
  });
}

export async function runPullList(opts: { format?: string } = {}): Promise<void> {
  const adapters = await availableSandboxAdapters();
  const listings: BackendListing[] = [];

  for (const adapter of adapters) {
    listings.push({
      backend: adapter.type,
      sandboxes: await adapter.listInstances(),
    });
  }

  if (opts.format === "json") {
    console.log(JSON.stringify({ backends: listings }, null, 2));
    return;
  }

  console.log(formatPullList(listings));
}

function formatPullList(listings: BackendListing[]): string {
  if (listings.length === 0) {
    return "No sandbox backends found. Install sbx or Docker to list local sandboxes.";
  }

  const lines: string[] = [];
  for (const listing of listings) {
    lines.push(listing.backend);
    if (listing.sandboxes.length === 0) {
      lines.push("  No sandboxes found.");
      continue;
    }

    const nameWidth = Math.max("name".length, ...listing.sandboxes.map((sandbox) => sandbox.name.length));
    const agentWidth = Math.max("agent".length, ...listing.sandboxes.map((sandbox) => sandbox.agent.length));
    const statusWidth = Math.max("status".length, ...listing.sandboxes.map((sandbox) => sandbox.status.length));
    lines.push(`  ${"name".padEnd(nameWidth)}  ${"agent".padEnd(agentWidth)}  ${"status".padEnd(statusWidth)}  workspaces`);

    for (const sandbox of listing.sandboxes) {
      const workspace = sandbox.workspaces.length > 0 ? sandbox.workspaces.join(", ") : "-";
      const missing = sandbox.workspaceMissing ? " workspace_missing" : "";
      const metadata = formatSandboxMetadata(sandbox.metadata);
      lines.push(
        `  ${sandbox.name.padEnd(nameWidth)}  ${sandbox.agent.padEnd(agentWidth)}  ${sandbox.status.padEnd(statusWidth)}  ${workspace}${missing}${metadata}`,
      );
    }
  }

  return lines.join("\n");
}

function formatSandboxMetadata(metadata: Record<string, string> | undefined): string {
  if (!metadata) {
    return "";
  }

  const entries = Object.entries(metadata).map(([key, value]) => `${key}=${value}`);
  return entries.length > 0 ? ` ${entries.join(" ")}` : "";
}

function hasAvailableWorkspace(sandbox: SandboxInstance): boolean {
  return sandbox.workspaces.length > 0 && sandbox.workspaceMissing !== true;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PullCommandResult {
  backend: string;
  name: string;
  stagingDir: string;
  checkpoint?: true;
  artifacts: PullResult["artifacts"];
  gaps: string[];
  provenance: PullResult["provenance"];
}

function buildPullCommandResult(params: {
  backend: string;
  name: string;
  stagingDir: string;
  result: PullResult;
  checkpoint?: boolean;
}): PullCommandResult {
  return {
    backend: params.backend,
    name: params.name,
    stagingDir: params.stagingDir,
    ...(params.checkpoint ? { checkpoint: true } : {}),
    artifacts: params.result.artifacts,
    gaps: params.result.gaps,
    provenance: params.result.provenance,
  };
}

function printPullResult(params: {
  backend: string;
  name: string;
  stagingDir: string;
  result: PullResult;
  format: string;
  checkpoint?: boolean;
}): void {
  const output = buildPullCommandResult(params);
  printPullCommandResult(output, params.format);
}

function printPullCommandResult(output: PullCommandResult, format: string): void {
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`${output.checkpoint ? "Checkpointed" : "Pulled"} ${output.backend}/${output.name} to ${output.stagingDir}`);
  if (output.gaps.length > 0) {
    console.log("Gaps:");
    for (const gap of output.gaps) {
      console.log(`  - ${gap}`);
    }
  }
}
