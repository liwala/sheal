import { DockerAdapter } from "./adapters/docker.js";
import { SbxAdapter } from "./adapters/sbx.js";
import type { SandboxAdapter } from "./types.js";

export function createSandboxAdapters(): SandboxAdapter[] {
  return [new SbxAdapter(), new DockerAdapter()];
}

export async function availableSandboxAdapters(
  adapters: SandboxAdapter[] = createSandboxAdapters(),
): Promise<SandboxAdapter[]> {
  const availability = await Promise.all(
    adapters.map(async (adapter) => ({
      adapter,
      available: await adapter.isAvailable(),
    })),
  );

  return availability.filter((item) => item.available).map((item) => item.adapter);
}
