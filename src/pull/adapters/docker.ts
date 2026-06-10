import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../../utils/exec.js";
import { ORDERED_CAPTURE_CANDIDATES } from "../capture-set.js";
import type { PullOptions, PullResult, SandboxAdapter, SandboxInstance } from "../types.js";

interface DockerContainer {
  ID?: unknown;
  Image?: unknown;
  Names?: unknown;
  State?: unknown;
  Status?: unknown;
}

interface DockerInstance extends SandboxInstance {
  containerId: string;
  image: string;
}

export class DockerAdapter implements SandboxAdapter {
  readonly type = "docker";

  async isAvailable(): Promise<boolean> {
    const result = await exec("docker", ["ps", "--all", "--no-trunc", "--format", "{{json .}}"], {
      env: { CI: undefined },
      timeoutMs: 5_000,
    });
    return result.exitCode === 0;
  }

  async listInstances(): Promise<SandboxInstance[]> {
    const result = await exec("docker", ["ps", "--all", "--no-trunc", "--format", "{{json .}}"], {
      env: { CI: undefined },
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(formatDockerError(result.stderr || result.stdout || `docker ps exited with ${result.exitCode}`));
    }

    return parseDockerPs(result.stdout);
  }

  async pull(name: string, stagingDir: string, options: PullOptions = {}): Promise<PullResult> {
    const container = (await this.listDockerInstances()).find((instance) => instance.name === name);
    if (!container) {
      throw new Error(`docker container not found: ${name}`);
    }

    const workspace = await this.readWorkingDirectory(name);
    const diffResult = await exec("docker", ["exec", name, "git", "-C", workspace, "diff"], {
      env: { CI: undefined },
      timeoutMs: 30_000,
    });
    if (diffResult.exitCode !== 0) {
      throw new Error(formatDockerError(diffResult.stderr || diffResult.stdout || `docker exec exited with ${diffResult.exitCode}`));
    }

    mkdirSync(stagingDir, { recursive: true });
    const diffPath = join(stagingDir, "git.diff");
    writeFileSync(diffPath, diffResult.stdout, "utf-8");
    const artifacts: PullResult["artifacts"] = [{ kind: "git.diff", path: diffPath, sourcePath: workspace }];
    const gaps: string[] = [];

    for (const candidate of ORDERED_CAPTURE_CANDIDATES) {
      const sourcePath = candidate.sourcePath(workspace);
      mkdirSync(candidate.ensureDestinationDir(stagingDir), { recursive: true });
      const copyResult = await exec("docker", ["cp", `${name}:${sourcePath}`, candidate.copyDestination(stagingDir)], {
        env: { CI: undefined },
        timeoutMs: 30_000,
      });

      if (copyResult.exitCode === 0) {
        artifacts.push({
          kind: candidate.kind,
          path: candidate.stagedPath(stagingDir),
          sourcePath,
        });
      } else {
        gaps.push(sourcePath);
      }
    }

    return {
      artifacts,
      gaps,
      provenance: {
        backend: "docker",
        type: "docker",
        name: container.name,
        agent: "docker",
        status: container.status,
        containerId: container.containerId,
        image: container.image,
        pulledAt: options.pulledAt ?? new Date().toISOString(),
        sourcePaths: [workspace],
        gaps,
      },
    };
  }

  private async listDockerInstances(): Promise<DockerInstance[]> {
    return (await this.listInstances()) as DockerInstance[];
  }

  private async readWorkingDirectory(name: string): Promise<string> {
    const result = await exec("docker", ["exec", name, "pwd"], {
      env: { CI: undefined },
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(formatDockerError(result.stderr || result.stdout || `docker exec pwd exited with ${result.exitCode}`));
    }

    const workspace = result.stdout.trim();
    if (!workspace) {
      throw new Error(`docker container ${name} did not report a working directory`);
    }
    return workspace;
  }
}

export function parseDockerPs(stdout: string): SandboxInstance[] {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => normalizeDockerContainer(JSON.parse(line) as DockerContainer, index));
}

function normalizeDockerContainer(container: DockerContainer, index: number): DockerInstance {
  const containerId = readString(container.ID, `containers[${index}].ID`);
  const image = readString(container.Image, `containers[${index}].Image`);
  const name = readContainerName(container.Names, `containers[${index}].Names`);
  const status = readString(container.State, `containers[${index}].State`);
  const statusDetail = readString(container.Status, `containers[${index}].Status`);

  return {
    backend: "docker",
    name,
    agent: "docker",
    status,
    workspaces: [],
    metadata: {
      id: containerId,
      image,
      containerStatus: statusDetail,
    },
    containerId,
    image,
  };
}

function readContainerName(value: unknown, field: string): string {
  const names = readString(value, field)
    .split(",")
    .map((name) => name.trim().replace(/^\//, ""))
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new Error(`docker ps field ${field} must include a container name`);
  }
  return names[0];
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`docker ps field ${field} must be a string`);
  }
  return value;
}

function formatDockerError(message: string): string {
  return message.trim() || "docker command failed";
}
