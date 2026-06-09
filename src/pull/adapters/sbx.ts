import { exec } from "../../utils/exec.js";
import type { SandboxAdapter, SandboxInstance } from "../types.js";

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
