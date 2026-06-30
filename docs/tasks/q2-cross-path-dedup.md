---
status: done
type: question
owner: Luisa
created: 2026-06-09
closed: 2026-06-12
---

# Q2. How do we dedup a session captured by more than one path (ADR 0005 cross-path dedup, ADR 0004 Q2)?

**Why it matters:** once remote adapters exist, one session can be captured both
by a local pull and via its cloud PR. ADR 0001 derives a pattern's `confidence`
from how many sessions reinforce it — double-counting one session fabricates
corroboration.

- Merge on a session/run id → clean, needs a stable shared id across paths.
- Keep highest-fidelity, drop the rest → simple, but must detect "same session".
- No dedup → confidence inflation; not acceptable long-term.

**Original open point:** what stable identity links two captures of the same
session. Moot while local-only.

**Why this becomes a problem:** sheal treats repeated evidence across sessions as
stronger evidence. If the same agent run is captured twice, for example once from
a local sandbox pull and once from a cloud PR trail, sheal may count one
experience as two independent confirmations. That can inflate confidence,
promote a weak rule too early, show duplicate timeline entries, and make future
"what happened?" queries look like multiple agents or sessions agreed when they
did not. The local-only path avoids this for now, but the first non-local capture
path needs a stable session/run identity or a highest-fidelity-wins merge rule.

**Answered (2026-06-12, current raw-registry review):** keep one canonical raw
session record per agent run, but make cross-source equivalence explicit instead
of inferred from paths, PRs, timestamps, or workspace names.

The smallest contract before remote/cloud sources is:

- `stableSessionId` remains the canonical raw-record id and directory name.
- Raw-session identity gains namespaced, authoritative aliases. Local captures
  should emit at least `agent-session:<agent>:<nativeSessionId>` and exact
  transcript hashes; remote/vendor captures should emit their provider run or
  session id when available.
- `manifest.json` should preserve multiple captures for a canonical session:
  source kind, source identity, fidelity, hashes, and provenance. A newer
  lower-fidelity capture must not erase higher-fidelity local evidence.
- Automatic dedup is allowed only when two captures share an authoritative alias
  such as the agent native session id, a provider session/run id, an explicit
  adapter-provided alias, or an exact transcript hash.
- Git/PR facts such as PR URL, branch, commit range, project path, and time
  window are correlation hints, not aliases. They can propose a link for review,
  but they must not auto-merge sessions because one PR can contain multiple
  agent runs.
- A remote/git-only capture that lacks an authoritative alias stays visible as
  `needs-link` evidence and is not allowed to increase pattern confidence until
  it is linked by a richer capture or an explicit human decision.

When an alias match exists, sheal should keep all captures as provenance, choose
the primary material by fidelity (`transcript+diff` over `transcript-only` over
`git/PR-only`), and count the canonical session once for confidence.

This produces follow-up implementation work for the raw registry alias/capture
metadata layer before the first remote/cloud source is added.
