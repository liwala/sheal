import { describe, it, expect } from "vitest";
import { parseRulesFromOutput } from "../src/commands/retro.js";

describe("parseRulesFromOutput", () => {
  it("parses **Rules:** with bullet points", () => {
    const output = `**Summary:** Did some work.

**Rules:**
- Always run tests before committing
- Check types after editing
- Validate inputs at boundaries

**For the Human:** Be more specific.`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual([
      "Always run tests before committing",
      "Check types after editing",
      "Validate inputs at boundaries",
    ]);
  });

  it("parses ## Rules heading", () => {
    const output = `## Summary
Did some work.

## Rules
- Always run tests before committing
- Check types after editing

## For the Human
Be more specific.`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual([
      "Always run tests before committing",
      "Check types after editing",
    ]);
  });

  it("parses ### Rules: heading", () => {
    const output = `### Rules:
- Rule one
- Rule two

### Next Section`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual(["Rule one", "Rule two"]);
  });

  it("parses **Rules**: (colon outside bold)", () => {
    const output = `**Rules**:
- First rule
- Second rule

**Next:**`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual(["First rule", "Second rule"]);
  });

  it("parses numbered lists", () => {
    const output = `**Rules:**
1. Always run tests
2. Check types
3. Validate inputs

**For the Human:**`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual([
      "Always run tests",
      "Check types",
      "Validate inputs",
    ]);
  });

  it("handles * bullet points", () => {
    const output = `**Rules:**
* First rule
* Second rule

**Summary:**`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual(["First rule", "Second rule"]);
  });

  it("returns empty array when no Rules section found", () => {
    const output = `**Summary:** Did some work.
**Top Issues:** None.`;

    expect(parseRulesFromOutput(output)).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(parseRulesFromOutput("")).toEqual([]);
  });

  it("handles Rules section at end of output (no following section)", () => {
    const output = `**Summary:** Work done.

**Rules:**
- Final rule one
- Final rule two
`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual(["Final rule one", "Final rule two"]);
  });

  it("skips non-bullet lines in Rules section", () => {
    const output = `**Rules:**
Here are some rules:
- Actual rule one
Some explanatory text
- Actual rule two

**Next:**`;

    const rules = parseRulesFromOutput(output);
    expect(rules).toEqual(["Actual rule one", "Actual rule two"]);
  });
});
