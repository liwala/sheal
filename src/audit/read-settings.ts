import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type ScopeLabel = "global" | "global-local" | "project" | "project-local";

export interface HookEntry {
  matcher: string;
  hooks: { type: string; command: string }[];
}

export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: unknown;
}

export interface SettingsScope {
  path: string;
  label: ScopeLabel;
  exists: boolean;
  raw: Record<string, unknown>;
  permissions: { allow: string[]; deny: string[] };
  hooks: Record<string, HookEntry[]>;
  mcpServers: Record<string, McpServer>;
  env: Record<string, string>;
  enabledPlugins: Record<string, boolean>;
}

export interface AuditReport {
  scopes: SettingsScope[];
  merged: {
    permissions: { allow: string[]; deny: string[] };
    hooks: { event: string; scope: ScopeLabel; command: string }[];
    mcpServers: { name: string; scope: ScopeLabel; config: McpServer }[];
    env: { key: string; value: string; scope: ScopeLabel }[];
    plugins: { name: string; enabled: boolean; scope: ScopeLabel }[];
  };
}

const KNOWN_KEYS = new Set([
  "permissions",
  "hooks",
  "mcpServers",
  "env",
  "enabledPlugins",
]);

function readScope(path: string, label: ScopeLabel): SettingsScope {
  const empty: SettingsScope = {
    path,
    label,
    exists: false,
    raw: {},
    permissions: { allow: [], deny: [] },
    hooks: {},
    mcpServers: {},
    env: {},
    enabledPlugins: {},
  };

  if (!existsSync(path)) return empty;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { ...empty, exists: true };
  }

  const perms = (raw.permissions ?? {}) as Record<string, string[]>;
  const hooks = (raw.hooks ?? {}) as Record<string, HookEntry[]>;
  const mcpServers = (raw.mcpServers ?? {}) as Record<string, McpServer>;
  const env = (raw.env ?? {}) as Record<string, string>;
  const enabledPlugins = (raw.enabledPlugins ?? {}) as Record<string, boolean>;

  return {
    path,
    label,
    exists: true,
    raw,
    permissions: {
      allow: Array.isArray(perms.allow) ? perms.allow : [],
      deny: Array.isArray(perms.deny) ? perms.deny : [],
    },
    hooks,
    mcpServers,
    env,
    enabledPlugins,
  };
}

export function readAllSettings(projectRoot: string): AuditReport {
  const home = homedir();
  const scopes = [
    readScope(join(home, ".claude", "settings.json"), "global"),
    readScope(join(home, ".claude", "settings.local.json"), "global-local"),
    readScope(join(projectRoot, ".claude", "settings.json"), "project"),
    readScope(join(projectRoot, ".claude", "settings.local.json"), "project-local"),
  ];

  // Merge across scopes
  const allAllow: string[] = [];
  const allDeny: string[] = [];
  const allHooks: { event: string; scope: ScopeLabel; command: string }[] = [];
  const allMcp: { name: string; scope: ScopeLabel; config: McpServer }[] = [];
  const allEnv: { key: string; value: string; scope: ScopeLabel }[] = [];
  const allPlugins: { name: string; enabled: boolean; scope: ScopeLabel }[] = [];

  for (const scope of scopes) {
    if (!scope.exists) continue;

    for (const p of scope.permissions.allow) {
      if (!allAllow.includes(p)) allAllow.push(p);
    }
    for (const p of scope.permissions.deny) {
      if (!allDeny.includes(p)) allDeny.push(p);
    }

    for (const [event, entries] of Object.entries(scope.hooks)) {
      for (const entry of entries) {
        for (const hook of entry.hooks ?? []) {
          allHooks.push({ event, scope: scope.label, command: hook.command });
        }
      }
    }

    for (const [name, config] of Object.entries(scope.mcpServers)) {
      allMcp.push({ name, scope: scope.label, config });
    }

    for (const [key, value] of Object.entries(scope.env)) {
      allEnv.push({ key, value, scope: scope.label });
    }

    for (const [name, enabled] of Object.entries(scope.enabledPlugins)) {
      allPlugins.push({ name, enabled, scope: scope.label });
    }
  }

  return {
    scopes,
    merged: {
      permissions: { allow: allAllow, deny: allDeny },
      hooks: allHooks,
      mcpServers: allMcp,
      env: allEnv,
      plugins: allPlugins,
    },
  };
}

/** Extract "other" settings keys (not permissions/hooks/mcpServers/env/plugins) */
export function otherSettings(scope: SettingsScope): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scope.raw)) {
    if (!KNOWN_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
