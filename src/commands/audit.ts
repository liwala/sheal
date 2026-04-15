import chalk from "chalk";
import { readAllSettings, otherSettings } from "../audit/read-settings.js";
import type { AuditReport, ScopeLabel } from "../audit/read-settings.js";

export interface AuditOptions {
  projectRoot: string;
  format: string;
}

function scopeTag(label: ScopeLabel): string {
  return chalk.gray(`[${label}]`);
}

function printPretty(report: AuditReport): void {
  const { scopes, merged } = report;

  console.log();
  console.log(chalk.bold("Claude Code Settings Audit"));
  console.log(chalk.gray("─".repeat(40)));

  // Settings files
  console.log();
  console.log(chalk.bold("Settings Files"));
  for (const scope of scopes) {
    const icon = scope.exists ? chalk.green("✓") : chalk.gray("○");
    const label = chalk.gray(`(${scope.label})`);
    const path = scope.exists ? scope.path : chalk.gray(scope.path);
    console.log(`  ${icon} ${path} ${label}`);
  }

  // Permissions
  console.log();
  console.log(chalk.bold("Permissions"));
  const scopesWithPerms = scopes.filter(
    (s) => s.exists && (s.permissions.allow.length > 0 || s.permissions.deny.length > 0),
  );
  if (scopesWithPerms.length === 0) {
    console.log(chalk.gray("  (none configured)"));
  } else {
    for (const scope of scopesWithPerms) {
      console.log(`  ${scopeTag(scope.label)}`);
      for (const p of scope.permissions.allow) {
        console.log(`    ${chalk.green("allow")} ${p}`);
      }
      for (const p of scope.permissions.deny) {
        console.log(`    ${chalk.red("deny")}  ${p}`);
      }
    }
  }

  // Hooks
  console.log();
  console.log(chalk.bold("Hooks"));
  if (merged.hooks.length === 0) {
    console.log(chalk.gray("  (none configured)"));
  } else {
    // Group by event
    const byEvent = new Map<string, { scope: ScopeLabel; command: string }[]>();
    for (const h of merged.hooks) {
      if (!byEvent.has(h.event)) byEvent.set(h.event, []);
      byEvent.get(h.event)!.push({ scope: h.scope, command: h.command });
    }
    for (const [event, hooks] of byEvent) {
      console.log(`  ${chalk.cyan(event)}`);
      for (const h of hooks) {
        console.log(`    ${scopeTag(h.scope)} ${h.command}`);
      }
    }
  }

  // MCP Servers
  console.log();
  console.log(chalk.bold("MCP Servers"));
  if (merged.mcpServers.length === 0) {
    console.log(chalk.gray("  (none configured)"));
  } else {
    for (const mcp of merged.mcpServers) {
      const cmd = mcp.config.command
        ? [mcp.config.command, ...(mcp.config.args ?? [])].join(" ")
        : mcp.config.url ?? "(unknown)";
      console.log(`  ${scopeTag(mcp.scope)} ${chalk.cyan(mcp.name)}`);
      console.log(`    ${cmd}`);
      if (mcp.config.env && Object.keys(mcp.config.env).length > 0) {
        for (const [k, v] of Object.entries(mcp.config.env)) {
          const display = k.toLowerCase().includes("key") || k.toLowerCase().includes("token")
            ? v.slice(0, 4) + "..."
            : v;
          console.log(`    ${chalk.gray(`${k}=${display}`)}`);
        }
      }
    }
  }

  // Environment variables
  console.log();
  console.log(chalk.bold("Environment Variables"));
  if (merged.env.length === 0) {
    console.log(chalk.gray("  (none configured)"));
  } else {
    for (const e of merged.env) {
      console.log(`  ${scopeTag(e.scope)} ${e.key}=${e.value}`);
    }
  }

  // Plugins
  console.log();
  console.log(chalk.bold("Plugins"));
  if (merged.plugins.length === 0) {
    console.log(chalk.gray("  (none configured)"));
  } else {
    for (const p of merged.plugins) {
      const status = p.enabled ? chalk.green("enabled") : chalk.gray("disabled");
      console.log(`  ${scopeTag(p.scope)} ${p.name}: ${status}`);
    }
  }

  // Other settings
  const otherEntries: { scope: ScopeLabel; key: string; value: unknown }[] = [];
  for (const scope of scopes) {
    if (!scope.exists) continue;
    const other = otherSettings(scope);
    for (const [key, value] of Object.entries(other)) {
      otherEntries.push({ scope: scope.label, key, value });
    }
  }

  if (otherEntries.length > 0) {
    console.log();
    console.log(chalk.bold("Other Settings"));
    for (const entry of otherEntries) {
      const val = typeof entry.value === "object"
        ? JSON.stringify(entry.value)
        : String(entry.value);
      console.log(`  ${scopeTag(entry.scope)} ${entry.key}: ${val}`);
    }
  }

  console.log();
}

export async function runAudit(options: AuditOptions): Promise<void> {
  const report = readAllSettings(options.projectRoot);

  if (options.format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printPretty(report);
  }
}
