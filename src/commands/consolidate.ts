import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { buildChangeSet, renderChangeSet, generateConsolidationPrompt } from "../consolidate/change-set.js";
import { getGlobalDir, getProjectDir } from "../learn/index.js";

export interface ConsolidateOptions {
  global: boolean;
  projectRoot: string;
  format: string;
  prompt: boolean;
}

export async function runConsolidate(opts: ConsolidateOptions): Promise<void> {
  const dir = opts.global ? getGlobalDir() : getProjectDir(opts.projectRoot);
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
