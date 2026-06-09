export interface SandboxInstance {
  backend: string;
  name: string;
  agent: string;
  status: string;
  workspaces: string[];
  workspaceMissing?: boolean;
}

export interface SandboxAdapter {
  type: string;
  isAvailable(): Promise<boolean>;
  listInstances(): Promise<SandboxInstance[]>;
}
