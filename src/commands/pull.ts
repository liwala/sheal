import { availableSandboxAdapters } from "../pull/registry.js";
import { createPullStage, writePullProvenance } from "../pull/stage.js";
import type { SandboxInstance } from "../pull/types.js";

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
  if (opts.list) {
    await runPullList({ format: opts.format ?? "pretty" });
    return;
  }

  if (opts.all) {
    await runPullAll(backend, name);
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

    const stage = createPullStage({ backend, name });
    const result = await adapter.pull(name, stage.dir, { pulledAt: stage.pulledAt });
    writePullProvenance(stage.dir, result.provenance);
    console.log(`Pulled ${backend}/${name} to ${stage.dir}`);
    return;
  }

  console.error("Specify --list, or use `sheal pull sbx <name>`.");
  process.exitCode = 1;
}

async function runPullAll(backend: string | undefined, name: string | undefined): Promise<void> {
  if (!backend || name) {
    console.error("Use `sheal pull sbx --all` to pull every sbx sandbox.");
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

  for (const sandbox of await adapter.listInstances()) {
    if (!hasAvailableWorkspace(sandbox)) {
      skipped += 1;
      console.log(`Skipped ${backend}/${sandbox.name}: missing workspace`);
      continue;
    }

    try {
      const stage = createPullStage({ backend, name: sandbox.name });
      const result = await adapter.pull(sandbox.name, stage.dir, { pulledAt: stage.pulledAt });
      writePullProvenance(stage.dir, result.provenance);
      pulled += 1;
      console.log(`Pulled ${backend}/${sandbox.name} to ${stage.dir}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${backend}/${sandbox.name}: ${formatError(error)}`);
    }
  }

  console.log(`Summary: pulled ${pulled}, skipped ${skipped}, failed ${failed}`);
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
    return "No sandbox backends found. Install sbx to list agent sandboxes.";
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
      const workspace = sandbox.workspaces.join(", ");
      const missing = sandbox.workspaceMissing ? " workspace_missing" : "";
      lines.push(
        `  ${sandbox.name.padEnd(nameWidth)}  ${sandbox.agent.padEnd(agentWidth)}  ${sandbox.status.padEnd(statusWidth)}  ${workspace}${missing}`,
      );
    }
  }

  return lines.join("\n");
}

function hasAvailableWorkspace(sandbox: SandboxInstance): boolean {
  return sandbox.workspaces.length > 0 && sandbox.workspaceMissing !== true;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
