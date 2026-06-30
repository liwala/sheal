import { availableSandboxAdapters } from "../pull/registry.js";
import { createPullStage, writePullProvenance } from "../pull/stage.js";
import { loadConfig } from "../config/loader.js";
import type { PullResult, SandboxInstance } from "../pull/types.js";

export interface PullOptions {
  list?: boolean;
  all?: boolean;
  format?: string;
}

interface BackendListing {
  backend: string;
  sandboxes: SandboxInstance[];
}

export async function runPull(backend: string | undefined, name: string | undefined, opts: PullOptions): Promise<void> {
  const config = loadConfig(process.cwd());

  if (opts.list) {
    await runPullList({ format: opts.format ?? "pretty" });
    return;
  }

  if (opts.all) {
    await runPullAll(backend, name, {
      format: opts.format ?? "pretty",
      stagingRoot: config.pull.stagingDir ?? undefined,
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
    writePullProvenance(stage.dir, result.provenance);
    printPullResult({ backend, name, stagingDir: stage.dir, result, format: opts.format ?? "pretty" });
    return;
  }

  console.error("Specify --list, or use `sheal pull <backend> <name>`.");
  process.exitCode = 1;
}

async function runPullAll(
  backend: string | undefined,
  name: string | undefined,
  opts: { format: string; stagingRoot?: string },
): Promise<void> {
  if (!backend || name) {
    console.error("Use `sheal pull sbx --all` to pull every sbx sandbox.");
    process.exitCode = 1;
    return;
  }

  if (backend === "docker") {
    console.error("sheal pull docker --all is not supported; use `sheal pull --list` and then `sheal pull docker <container>`.");
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

  let pulled = 0;
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
      const stage = createPullStage({ stagingRoot: opts.stagingRoot, backend, name: sandbox.name });
      const result = await adapter.pull(sandbox.name, stage.dir, { pulledAt: stage.pulledAt });
      writePullProvenance(stage.dir, result.provenance);
      pulled += 1;
      results.push(buildPullCommandResult({ backend, name: sandbox.name, stagingDir: stage.dir, result }));
      if (opts.format !== "json") {
        printPullResult({ backend, name: sandbox.name, stagingDir: stage.dir, result, format: opts.format });
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
    console.log(JSON.stringify({ pulled, skipped, failed, results, skippedSandboxes, failures }, null, 2));
  } else {
    console.log(`Summary: pulled ${pulled}, skipped ${skipped}, failed ${failed}`);
  }
  if (pulled === 0 && failed > 0) {
    process.exitCode = 1;
  }
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
  artifacts: PullResult["artifacts"];
  gaps: string[];
  provenance: PullResult["provenance"];
}

function buildPullCommandResult(params: {
  backend: string;
  name: string;
  stagingDir: string;
  result: PullResult;
}): PullCommandResult {
  return {
    backend: params.backend,
    name: params.name,
    stagingDir: params.stagingDir,
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
}): void {
  const output = buildPullCommandResult(params);

  if (params.format === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(`Pulled ${params.backend}/${params.name} to ${params.stagingDir}`);
  if (params.result.gaps.length > 0) {
    console.log("Gaps:");
    for (const gap of params.result.gaps) {
      console.log(`  - ${gap}`);
    }
  }
}
