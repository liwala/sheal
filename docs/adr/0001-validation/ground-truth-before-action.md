# Ground truth before action

**Tier:** global · **Confidence:** highest in corpus (reinforced across 4+
sessions, including sessions _after_ the rules existed).

Never act on documentation, type definitions, screenshots, or memory of a data
format — fetch a real sample, run `--help`, or reproduce the bug first.

## Members

| ID                | Gist                                                      | Provenance                       |
| ----------------- | --------------------------------------------------------- | -------------------------------- |
| LEARN-001 (+001S) | Inspect 2–3 real samples before writing parsers           | 2026-03-13, retro `c4419b557931` |
| LEARN-003L        | Verify fixtures match real data side-by-side              | 2026-03-13, same                 |
| LEARN-006L        | Save a real sample as a fixture before parsing            | 2026-03-13, same                 |
| LEARN-002 (+002S) | `--help` before using unfamiliar CLIs                     | 2026-03-13, same                 |
| LEARN-012L        | New agent runtime: `--help` + one manual invocation first | 2026-03-20, retro `ba1775df5773` |
| LEARN-025         | Reproduce user-reported UX issue before coding a fix      | 2026-03-26, session `b39d0c2a`   |
| LEARN-028         | Reproduce screenshot-reported UI bug locally first        | 2026-04-14, session `f704d6d6`   |

## Proposed merged rules

1. **Parsers/fixtures:** before writing a parser or fixture for any external
   format, fetch 2–3 real samples, save one as a test fixture, and verify the
   fixture matches real structure side-by-side. _(absorbs 001, 003L, 006L)_
2. **Unfamiliar tools:** before first use of an unfamiliar CLI or agent
   runtime, read `--help` (including the subcommand) and test one manual
   invocation before writing integration code. _(absorbs 002, 012L)_
3. **Reported bugs:** when a user reports a UX/UI issue (terminal output or
   screenshot), reproduce the exact broken state locally before editing code.
   _(absorbs 025, 028)_

## Trigger table

| Trigger                                                           | Rule |
| ----------------------------------------------------------------- | ---- |
| About to write a parser or test fixture                           | 1    |
| First invocation of a CLI/runtime not used before in this project | 2    |
| User shares output/screenshot showing a defect                    | 3    |
