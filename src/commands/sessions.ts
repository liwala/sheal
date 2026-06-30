import { normalizeSessionSource } from "../sessions/raw-registry.js";

export interface SessionsImportOptions {
  projectRoot: string;
  source?: string;
  format: string;
}

export function runSessionsImport(options: SessionsImportOptions): void {
  const result = normalizeSessionSource({
    projectRoot: options.projectRoot,
    sourceRoot: options.source,
  });
  const output = {
    imported: result.rawSessionIds.length,
    rawSessionIds: result.rawSessionIds,
  };

  if (options.format === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (output.imported === 0) {
    console.log("No Claude or Codex sessions found for this project.");
    return;
  }

  console.log(`Imported ${output.imported} session(s) into .sheal/sessions/raw/`);
  for (const rawSessionId of output.rawSessionIds) {
    console.log(`  - ${rawSessionId}`);
  }
}
