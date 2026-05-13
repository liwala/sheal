import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Checker, CheckDetail, CheckResult, CheckerContext } from "./types.js";
import { exec } from "../utils/exec.js";
import { startTimer } from "../utils/timer.js";

interface Ecosystem {
  name: string;
  detect: (root: string) => boolean;
  check: (root: string) => Promise<CheckDetail>;
}

const ecosystems: Ecosystem[] = [
  {
    name: "node",
    detect: (root) => existsSync(join(root, "package.json")),
    check: async (root) => {
      const nmPath = join(root, "node_modules");
      if (!existsSync(nmPath)) {
        return { message: "node_modules missing — run npm install", severity: "fail" };
      }
      const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb"]
        .filter((f) => existsSync(join(root, f)));

      // npm updates node_modules/.package-lock.json during install; the
      // node_modules directory mtime itself can remain old.
      const installMarker = join(nmPath, ".package-lock.json");
      const installMtime = statSync(existsSync(installMarker) ? installMarker : nmPath).mtimeMs;
      const manifestMtime = Math.max(
        statSync(join(root, "package.json")).mtimeMs,
        ...lockfiles.map((f) => statSync(join(root, f)).mtimeMs),
      );
      if (manifestMtime > installMtime) {
        return {
          message: "package manifest is newer than installed dependencies — run npm install",
          severity: "warn",
        };
      }
      return {
        message: `Node dependencies OK (lockfile: ${lockfiles[0] ?? "none"})`,
        severity: "pass",
        data: { lockfiles },
      };
    },
  },
  {
    name: "python",
    detect: (root) =>
      existsSync(join(root, "requirements.txt")) ||
      existsSync(join(root, "pyproject.toml")) ||
      existsSync(join(root, "Pipfile")),
    check: async (root) => {
      const hasVenv = !!process.env.VIRTUAL_ENV;
      const configFile = ["pyproject.toml", "requirements.txt", "Pipfile"]
        .find((f) => existsSync(join(root, f)));
      if (!hasVenv) {
        return {
          message: `Python project detected (${configFile}) but no virtualenv active`,
          severity: "warn",
        };
      }
      return { message: `Python environment OK (${configFile}, venv active)`, severity: "pass" };
    },
  },
  {
    name: "go",
    detect: (root) => existsSync(join(root, "go.mod")),
    check: async (root) => {
      const result = await exec("go", ["mod", "verify"], { cwd: root, timeoutMs: 10_000 });
      if (result.exitCode !== 0) {
        return { message: "go mod verify failed", severity: "warn", data: { stderr: result.stderr.slice(0, 300) } };
      }
      return { message: "Go modules verified", severity: "pass" };
    },
  },
  {
    name: "rust",
    detect: (root) => existsSync(join(root, "Cargo.toml")),
    check: async (root) => {
      if (!existsSync(join(root, "target"))) {
        return { message: "Rust target/ directory missing — run cargo build", severity: "warn" };
      }
      return { message: "Rust project detected, target/ exists", severity: "pass" };
    },
  },
];

export const dependenciesChecker: Checker = {
  name: "dependencies",
  label: "Dependencies",
  async run(ctx: CheckerContext): Promise<CheckResult> {
    const elapsed = startTimer();
    const details: CheckDetail[] = [];
    const configured = ctx.config.checkers.dependencies.ecosystems;

    const active = configured.length > 0
      ? ecosystems.filter((e) => configured.includes(e.name as "node" | "python" | "go" | "rust"))
      : ecosystems.filter((e) => e.detect(ctx.projectRoot));

    if (active.length === 0) {
      return {
        name: this.name, label: this.label, severity: "skip",
        details: [{ message: "No recognized dependency ecosystem detected", severity: "skip" }],
        durationMs: elapsed(),
      };
    }

    for (const eco of active) {
      details.push(await eco.check(ctx.projectRoot));
    }

    const worst = details.some((d) => d.severity === "fail") ? "fail"
      : details.some((d) => d.severity === "warn") ? "warn" : "pass";

    return { name: this.name, label: this.label, severity: worst as CheckResult["severity"], details, durationMs: elapsed() };
  },
};
