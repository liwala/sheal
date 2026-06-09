import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 10_000,
        cwd: options.cwd,
        maxBuffer: options.maxBuffer ?? 50 * 1024 * 1024,
        env: buildEnv(options.env),
      },
      (error, stdout, stderr) => {
        const timedOut = error?.killed === true;
        const exitCode = timedOut ? -1 : (error as NodeJS.ErrnoException)?.code === "ENOENT" ? -2 : (child.exitCode ?? 1);
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode,
          timedOut,
        });
      },
    );
    // Close stdin so child processes don't wait for input
    child.stdin?.end();
  });
}

function buildEnv(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "true", NO_COLOR: "1", ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete env[key];
    }
  }
  return env;
}
