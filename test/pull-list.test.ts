import { describe, it, expect, afterEach } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();

describe("sheal pull --list", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("lists sbx sandboxes with agent, status, workspaces, and missing workspace markers", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-list-"));
    const sbxPath = join(tmp, "sbx");
    const fixturePath = join(repoRoot, "test", "fixtures", "sbx-ls.json");

    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
import { readFileSync } from "node:fs";

if (process.env.CI === "true") {
  console.error("sbx auth failed under CI");
  process.exit(42);
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(readFileSync(${JSON.stringify(fixturePath)}, "utf-8"));
  process.exit(0);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "pull", "--list"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${tmp}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sbx");
    expect(result.stdout).toContain("claude-acme-api");
    expect(result.stdout).toContain("claude");
    expect(result.stdout).toContain("running");
    expect(result.stdout).toContain("/Users/example/code/acme/api");
    expect(result.stdout).toContain("codex-missing-worktree");
    expect(result.stdout).toContain("codex");
    expect(result.stdout).toContain("stopped");
    expect(result.stdout).toContain("/Users/example/code/acme/missing-worktree");
    expect(result.stdout).toContain("workspace_missing");
  });

  it("lists sbx sandboxes and Docker containers with selection metadata", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-list-"));
    const sbxPath = join(tmp, "sbx");
    const dockerPath = join(tmp, "docker");
    const fixturePath = join(repoRoot, "test", "fixtures", "sbx-ls.json");
    const containers = [
      {
        ID: "0f1e2d3c4b5a",
        Image: "ghcr.io/liwala/codex-runner:latest",
        Names: "codex-acme-api",
        State: "running",
        Status: "Up 2 hours",
      },
      {
        ID: "123456789abc",
        Image: "node:22",
        Names: "claude-web-ui",
        State: "exited",
        Status: "Exited (0) 3 minutes ago",
      },
    ];

    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  process.stdout.write(readFileSync(${JSON.stringify(fixturePath)}, "utf-8"));
  process.exit(0);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    writeFileSync(
      dockerPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const containers = ${JSON.stringify(containers)};

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("docker help\\n");
  process.exit(0);
}

if (args[0] === "ps" && args.includes("--all") && args.includes("--format")) {
  process.stdout.write(containers.map((container) => JSON.stringify(container)).join("\\n") + "\\n");
  process.exit(0);
}

console.error(\`unexpected docker args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(dockerPath, 0o755);

    const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "pull", "--list"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${tmp}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sbx");
    expect(result.stdout).toContain("claude-acme-api");
    expect(result.stdout).toContain("docker");
    expect(result.stdout).toContain("codex-acme-api");
    expect(result.stdout).toContain("0f1e2d3c4b5a");
    expect(result.stdout).toContain("ghcr.io/liwala/codex-runner:latest");
    expect(result.stdout).toContain("running");
    expect(result.stdout).toContain("claude-web-ui");
    expect(result.stdout).toContain("123456789abc");
    expect(result.stdout).toContain("node:22");
    expect(result.stdout).toContain("exited");
  });

  it("surfaces sbx list failures when sbx is installed", () => {
    tmp = mkdtempSync(join(tmpdir(), "sheal-pull-list-"));
    const sbxPath = join(tmp, "sbx");

    writeFileSync(
      sbxPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write("sbx help\\n");
  process.exit(0);
}

if (args.length === 2 && args[0] === "ls" && args[1] === "--json") {
  console.error("unexpected authentication error");
  process.exit(1);
}

console.error(\`unexpected sbx args: \${args.join(" ")}\`);
process.exit(99);
`,
    );
    chmodSync(sbxPath, 0o755);

    const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "pull", "--list"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${tmp}${delimiter}${process.env.PATH ?? ""}`,
        NO_COLOR: "1",
      },
      encoding: "utf-8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unexpected authentication error");
    expect(result.stdout).not.toContain("No sandbox backends found");
  });
});
