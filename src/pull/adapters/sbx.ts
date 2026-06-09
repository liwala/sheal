import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../../utils/exec.js";
import type { PullOptions, PullResult, SandboxAdapter, SandboxInstance } from "../types.js";

interface SbxListOutput {
  sandboxes?: unknown;
}

interface SbxSandbox {
  name?: unknown;
  agent?: unknown;
  status?: unknown;
  workspaces?: unknown;
  workspace_missing?: unknown;
}

export class SbxAdapter implements SandboxAdapter {
  readonly type = "sbx";

  async isAvailable(): Promise<boolean> {
    const result = await exec("sbx", ["--help"], { env: { CI: undefined }, timeoutMs: 5_000 });
    return result.exitCode === 0;
  }

  async listInstances(): Promise<SandboxInstance[]> {
    const result = await exec("sbx", ["ls", "--json"], { env: { CI: undefined }, timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      throw new Error(formatSbxError(result.stderr || result.stdout || `sbx exited with ${result.exitCode}`));
    }

    return parseSbxList(result.stdout);
  }

  async pull(name: string, stagingDir: string, options: PullOptions = {}): Promise<PullResult> {
    const sandbox = (await this.listInstances()).find((instance) => instance.name === name);
    if (!sandbox) {
      throw new Error(`sbx sandbox not found: ${name}`);
    }

    const workspace = sandbox.workspaces[0];
    if (!workspace || sandbox.workspaceMissing) {
      throw new Error(`sbx sandbox ${name} does not have an available workspace`);
    }

    const result = await exec("sbx", ["exec", name, "git", "-C", workspace, "diff"], {
      env: { CI: undefined },
      timeoutMs: 30_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(formatSbxError(result.stderr || result.stdout || `sbx exec exited with ${result.exitCode}`));
    }

    mkdirSync(stagingDir, { recursive: true });
    const diffPath = join(stagingDir, "git.diff");
    writeFileSync(diffPath, result.stdout, "utf-8");

    return {
      artifacts: [{ kind: "git.diff", path: diffPath, sourcePath: workspace }],
      gaps: [],
      provenance: {
        backend: "sbx",
        type: "sbx",
        name: sandbox.name,
        agent: sandbox.agent,
        status: sandbox.status,
        pulledAt: options.pulledAt ?? new Date().toISOString(),
        sourcePaths: [workspace],
      },
    };
  }
}

export function parseSbxList(stdout: string): SandboxInstance[] {
  const parsed = JSON.parse(stdout) as SbxListOutput;
  if (!Array.isArray(parsed.sandboxes)) {
    throw new Error("sbx ls --json did not include a sandboxes array");
  }

  return parsed.sandboxes.map((sandbox, index) => normalizeSbxSandbox(sandbox as SbxSandbox, index));
}

function normalizeSbxSandbox(sandbox: SbxSandbox, index: number): SandboxInstance {
  const name = readString(sandbox.name, `sandboxes[${index}].name`);
  const agent = readString(sandbox.agent, `sandboxes[${index}].agent`);
  const status = readString(sandbox.status, `sandboxes[${index}].status`);
  const workspaces = readStringArray(sandbox.workspaces, `sandboxes[${index}].workspaces`);

  return {
    backend: "sbx",
    name,
    agent,
    status,
    workspaces,
    workspaceMissing: sandbox.workspace_missing === true,
  };
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`sbx ls --json field ${field} must be a string`);
  }
  return value;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`sbx ls --json field ${field} must be an array of strings`);
  }
  return value;
}

function formatSbxError(message: string): string {
  return message.trim() || "sbx ls --json failed";
}
