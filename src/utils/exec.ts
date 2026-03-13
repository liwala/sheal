import { execFile } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export function exec(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 10_000,
        cwd: options.cwd,
        maxBuffer: 50 * 1024 * 1024, // 50MB — transcripts can be large
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
  });
}
