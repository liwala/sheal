import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { exec } from "../utils/exec.js";
import { startTimer } from "../utils/timer.js";

/**
 * Detect which AI coding agent is active in the project.
 */
function detectAgent(projectRoot: string): string | null {
  if (existsSync(join(projectRoot, "CLAUDE.md")) || existsSync(join(projectRoot, ".claude"))) {
    return "claude";
  }
  if (existsSync(join(projectRoot, ".cursorrules"))) return "cursor";
  if (existsSync(join(projectRoot, ".gemini", "GEMINI.md"))) return "gemini";
  if (existsSync(join(projectRoot, ".github", "copilot-instructions.md"))) return "copilot";
  return null;
}

/**
 * Measure the total size of agent config files in bytes.
 */
function measureConfigSize(projectRoot: string): { totalBytes: number; files: { path: string; bytes: number }[] } {
  const candidates = [
    "CLAUDE.md",
    ".cursorrules",
    "AGENTS.md",
    ".gemini/GEMINI.md",
    ".github/copilot-instructions.md",
    ".self-heal.json",
  ];

  const files: { path: string; bytes: number }[] = [];
  let totalBytes = 0;

  for (const rel of candidates) {
    const full = join(projectRoot, rel);
    if (existsSync(full)) {
      const bytes = statSync(full).size;
      files.push({ path: rel, bytes });
      totalBytes += bytes;
    }
  }

  return { totalBytes, files };
}

/**
 * Try to read Claude Code settings to check for MCP and LSP plugin config.
 */
function checkClaudeCodeSettings(projectRoot: string): {
  mcpServers: string[];
  lspPlugins: string[];
} {
  const mcpServers: string[] = [];
  const lspPlugins: string[] = [];

  // Check all settings scopes for enabled plugins and MCP servers
  const settingsPaths = [
    join(homedir(), ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.json"),
    join(projectRoot, ".claude", "settings.local.json"),
  ];

  for (const settingsPath of settingsPaths) {
    if (!existsSync(settingsPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(settingsPath, "utf-8"));

      // MCP servers
      for (const name of Object.keys(raw.mcpServers ?? {})) {
        if (!mcpServers.includes(name)) mcpServers.push(name);
      }

      // LSP plugins (convention: plugin names containing "lsp")
      for (const [name, enabled] of Object.entries(raw.enabledPlugins ?? {})) {
        if (enabled && name.toLowerCase().includes("lsp") && !lspPlugins.includes(name)) {
          lspPlugins.push(name);
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return { mcpServers, lspPlugins };
}

// 10KB warn, 20KB fail for total agent config size
const CONFIG_WARN_BYTES = 10_000;
const CONFIG_FAIL_BYTES = 20_000;

export const performanceChecker: Checker = {
  name: "performance",
  label: "Performance & Efficiency",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];
    const agent = detectAgent(ctx.projectRoot);

    if (agent) {
      details.push({ message: `Detected agent: ${agent}`, severity: "pass" });
    }

    // RTK check
    const rtkResult = await exec("which", ["rtk"], { cwd: ctx.projectRoot, timeoutMs: 3_000 });
    if (rtkResult.exitCode === 0) {
      details.push({ message: "RTK installed (token compression proxy)", severity: "pass" });

      // Check if RTK hook is configured for Claude Code
      if (agent === "claude") {
        const hooksPath = join(homedir(), ".claude", "settings.json");
        if (existsSync(hooksPath)) {
          try {
            const settings = JSON.parse(readFileSync(hooksPath, "utf-8"));
            const hooks = settings.hooks ?? {};
            const hasRtkHook = JSON.stringify(hooks).includes("rtk");
            if (hasRtkHook) {
              details.push({ message: "RTK hook active in Claude Code", severity: "pass" });
            } else {
              details.push({ message: "RTK installed but no hook configured in Claude Code settings", severity: "warn" });
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } else {
      details.push({
        message: "RTK not installed — token compression can save 60-90% on context",
        severity: "warn",
        data: { url: "https://github.com/rtk-ai/rtk" },
      });
    }

    // MCP and LSP checks (Claude Code only)
    if (agent === "claude") {
      const { mcpServers, lspPlugins } = checkClaudeCodeSettings(ctx.projectRoot);

      if (mcpServers.length > 0) {
        details.push({
          message: `MCP servers: ${mcpServers.join(", ")}`,
          severity: "pass",
        });
      }

      if (lspPlugins.length > 0) {
        details.push({
          message: `LSP plugins: ${lspPlugins.map((p) => p.split("@")[0]).join(", ")}`,
          severity: "pass",
        });
      } else {
        details.push({
          message: "No LSP plugins enabled — LSP gives Claude Code diagnostics and go-to-definition",
          severity: "warn",
        });
      }
    }

    // Agent config size check
    const { totalBytes, files } = measureConfigSize(ctx.projectRoot);
    if (files.length > 0) {
      const totalKb = (totalBytes / 1024).toFixed(1);
      const fileList = files.map((f) => `${f.path} (${(f.bytes / 1024).toFixed(1)}KB)`).join(", ");

      if (totalBytes > CONFIG_FAIL_BYTES) {
        details.push({
          message: `Agent config is bloated: ${totalKb}KB total (${fileList}) — consider trimming to reduce context usage`,
          severity: "warn",
          data: { totalBytes, files },
        });
      } else if (totalBytes > CONFIG_WARN_BYTES) {
        details.push({
          message: `Agent config size: ${totalKb}KB (${fileList}) — approaching threshold, consider trimming`,
          severity: "warn",
          data: { totalBytes, files },
        });
      } else {
        details.push({
          message: `Agent config size: ${totalKb}KB (${files.length} file(s))`,
          severity: "pass",
        });
      }
    }

    // Model info (informational — check Claude Code project settings)
    if (agent === "claude") {
      const projectSettingsPath = join(ctx.projectRoot, ".claude", "settings.json");
      if (existsSync(projectSettingsPath)) {
        try {
          const settings = JSON.parse(readFileSync(projectSettingsPath, "utf-8"));
          if (settings.model) {
            details.push({ message: `Model: ${settings.model}`, severity: "pass" });
          }
        } catch {
          // ignore
        }
      }
    }

    const worst = details.some((d) => d.severity === "fail") ? "fail"
      : details.some((d) => d.severity === "warn") ? "warn" : "pass";

    return { name: this.name, label: this.label, severity: worst as CheckResult["severity"], details, durationMs: elapsed() };
  },
};
