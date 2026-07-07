import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { buildChangeSet, renderChangeSet, generateConsolidationPrompt } from "../consolidate/change-set.js";
import { applyDecisions } from "../consolidate/apply.js";
import type { DecisionsFile } from "../consolidate/apply.js";
import { getGlobalDir, getProjectDir } from "../learn/index.js";

export interface ConsolidateOptions {
  global: boolean;
  projectRoot: string;
  format: string;
  prompt: boolean;
  decisions?: string;
  apply: boolean;
}

export async function runConsolidate(opts: ConsolidateOptions): Promise<void> {
  const dir = opts.global ? getGlobalDir() : getProjectDir(opts.projectRoot);

  if (opts.decisions) {
    runApplyStage(dir, opts.decisions, opts.apply);
    return;
  }

  const changeSet = buildChangeSet(dir);

  if (opts.prompt) {
    console.log(generateConsolidationPrompt(dir, changeSet));
    return;
  }

  if (opts.format === "json") {
    console.log(JSON.stringify(changeSet, null, 2));
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const outDir = opts.global
    ? join(getGlobalDir(), "..", "consolidation")
    : join(opts.projectRoot, ".sheal", "consolidation");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${date}-change-set.md`);
  writeFileSync(outFile, renderChangeSet(changeSet, date), "utf-8");

  const total = changeSet.idCollisions.length + changeSet.mergeCandidates.length + changeSet.dispositions.length;
  console.log(chalk.bold(`Consolidation change set — ${changeSet.scanned} learnings scanned`));
  console.log(
    `  ${changeSet.idCollisions.length} ID collision(s), ${changeSet.mergeCandidates.length} merge candidate(s), ${changeSet.dispositions.length} disposition(s)`,
  );
  console.log(`  ${total === 0 ? chalk.green("store is clean") : chalk.yellow("proposal written (store untouched)")}`);
  console.log(chalk.gray(`  ${outFile}`));
  console.log(chalk.gray(`  LLM judgment stage: sheal consolidate --prompt | <your agent CLI>`));
}

function runApplyStage(dir: string, decisionsPath: string, apply: boolean): void {
  let decisionsFile: DecisionsFile;
  try {
    decisionsFile = JSON.parse(readFileSync(decisionsPath, "utf-8")) as DecisionsFile;
    if (!Array.isArray(decisionsFile.decisions)) {
      throw new Error(`missing a top-level "decisions" array`);
    }
  } catch (err) {
    console.error(chalk.red(`Could not read decisions file ${decisionsPath}: ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = applyDecisions(dir, decisionsFile, { apply });
  } catch (err) {
    console.error(chalk.red(`Decisions not applied: ${(err as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const mode = result.applied ? chalk.green("applied") : chalk.yellow("dry run (pass --apply to execute)");
  console.log(chalk.bold(`Consolidation apply stage — ${result.planned.length} decision(s), ${mode}`));
  for (const p of result.planned) {
    console.log(`  ${p.action.padEnd(9)} ${p.file} — ${p.detail}`);
  }
}
