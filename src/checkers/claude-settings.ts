import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { readAllSettings } from "../audit/read-settings.js";
import { startTimer } from "../utils/timer.js";

export const claudeSettingsChecker: Checker = {
  name: "claude-settings",
  label: "Claude Code Settings",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];

    // Only run if this is a Claude Code project
    const isClaude =
      existsSync(join(ctx.projectRoot, "CLAUDE.md")) ||
      existsSync(join(ctx.projectRoot, ".claude"));

    if (!isClaude) {
      return {
        name: this.name,
        label: this.label,
        severity: "skip",
        details: [{ message: "Not a Claude Code project", severity: "skip" }],
        durationMs: elapsed(),
      };
    }

    const report = readAllSettings(ctx.projectRoot);
    const { scopes, merged } = report;

    // Files found
    const found = scopes.filter((s) => s.exists);
    details.push({
      message: `${found.length} settings file(s): ${found.map((s) => s.label).join(", ")}`,
      severity: "pass",
    });

    // Permissions summary
    const totalPerms = merged.permissions.allow.length + merged.permissions.deny.length;
    if (totalPerms > 0) {
      details.push({
        message: `${merged.permissions.allow.length} allow / ${merged.permissions.deny.length} deny permission(s)`,
        severity: "pass",
      });
    }

    // Hooks summary
    if (merged.hooks.length > 0) {
      const events = new Set(merged.hooks.map((h) => h.event));
      details.push({
        message: `${merged.hooks.length} hook(s) across ${events.size} event(s)`,
        severity: "pass",
      });
    }

    // MCP servers
    if (merged.mcpServers.length > 0) {
      details.push({
        message: `MCP servers: ${merged.mcpServers.map((m) => m.name).join(", ")}`,
        severity: "pass",
      });
    }

    // Env vars
    if (merged.env.length > 0) {
      details.push({
        message: `${merged.env.length} env var(s)`,
        severity: "pass",
      });
    }

    // Plugins
    if (merged.plugins.length > 0) {
      const enabled = merged.plugins.filter((p) => p.enabled);
      details.push({
        message: `${enabled.length} plugin(s) enabled`,
        severity: "pass",
      });
    }

    details.push({
      message: "Run `sheal audit` for full details",
      severity: "pass",
    });

    return {
      name: this.name,
      label: this.label,
      severity: "pass",
      details,
      durationMs: elapsed(),
    };
  },
};
