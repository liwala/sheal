import { gitChecker } from "./git.js";
import { dependenciesChecker } from "./dependencies.js";
import { testsChecker } from "./tests.js";
import { environmentChecker } from "./environment.js";
import { sessionLearningsChecker } from "./session-learnings.js";
import { performanceChecker } from "./performance.js";
import { claudeSettingsChecker } from "./claude-settings.js";
import type { Checker } from "./types.js";

export const allCheckers: Checker[] = [
  gitChecker,
  dependenciesChecker,
  testsChecker,
  environmentChecker,
  sessionLearningsChecker,
  performanceChecker,
  claudeSettingsChecker,
];
