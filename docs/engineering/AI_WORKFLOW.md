# AI-assisted engineering workflow

## Roles

- **ChatGPT** is product owner, architecture partner, and release controller: reads the Master Production Specification, orders stories, performs scope analysis, approves scope-lock, evaluates reports, and controls staging/commit/push/release decisions.
- **Codex** is the preferred implementation agent: audits approved scope, implements it, performs mechanical validation and self-review, fixes straightforward defects, and returns the implementation report. It does not stage, commit, push, deploy, or mutate hosted resources unless explicitly instructed.
- **Claude** is the default independent hostile reviewer for high-risk work: it distrusts reports, inspects actual behavior and diffs, and adversarially tests account isolation, races, privacy, and security. It may make only small, clear in-scope fixes; it must report new product or architecture decisions. Claude Code may be explicitly assigned implementation work when needed.
- **Human** explicitly approves scope-lock and owns destructive and release actions, including required physical-device QA.

## Normal story lifecycle

1. Confirm the expected clean baseline.
2. Read the Master Specification, applicable ADRs, and repository state.
3. Audit the approved scope and issue a scope-lock.
4. Obtain human approval.
5. The approved implementation agent implements, validates, and self-reviews.
6. Perform independent review appropriate to the risk tier; fix findings.
7. Obtain human staging approval; stage only the explicit manifest and verify the staged diff.
8. Commit, verify the local SHA, push, verify the remote SHA, and verify CI for that exact SHA.
9. Let the automatic Staging database workflow run; run the manual Production database workflow where applicable.
10. Complete required post-release/device QA and close the story with evidence.

Staging and Production GitHub workflows are **database-migration pipelines**, not mobile-client deployments. A client-only or docs-only story may pass them as no-op DB gates.

## Risk tiers

| Tier | Review expectation |
| --- | --- |
| **High-risk** | Independent review, preferably by a different model/provider from the implementer, is expected: P0; auth/session/account deletion; account isolation; encryption; sensitive health/document data; privacy/data rights; schema/RLS/grants; destructive migrations; payments/entitlements; permissions; AI tool/write boundaries; or security-critical notifications/deep links. |
| **Normal** | Fresh review normally suffices for ordinary P1 domain/product changes without sensitive boundaries. |
| **Low-risk** | Narrow docs/test-only/trivial P2 work may use justified self-review. |

Risk wins over story priority.

## Quota-aware agent handoff

Quota state may come only from the user, an active runtime/tool warning, or be **unknown**. Do not invent a remaining percentage or reset time when it is not visible.

- **GREEN:** sufficient usage is believed available; normal story execution and its checkpoints may begin.
- **YELLOW:** usage is uncertain or constrained. Do not start a substantial story unless the user explicitly wants to; finish the current coherent checkpoint, run available relevant validation, and prepare a clean handoff.
- **RED:** the agent is likely to exhaust usable quota before the next coherent checkpoint, or the user says it is nearly exhausted. Do not begin another substantial implementation phase; stop at the nearest safe checkpoint, preserve the working tree, run affordable appropriate validation, and return the Agent Handoff Report. Another approved agent may continue that same tree.

Never rush risky work, or stage or commit incomplete work, to beat a reset. Never discard correct uncommitted work because another agent continues. A handoff is preferable to an undocumented half-completed story. The approved scope-lock survives a handoff: the receiving agent must inspect the real working tree and diff, preserve correct work, fix incorrect work, and finish only approved scope. A provider/model switch never authorizes expansion.

### Coherent implementation checkpoints

A checkpoint is a safe pause in the implementation, not an artificial commit. Typical examples are domain/contracts, persistence/server changes, client lifecycle/security integration, tests, and documentation/final validation; these are examples, not required layers. A safe handoff ideally has a syntactically valid tree where practical, no intentionally half-written migration/schema pair, recorded decisions, exact changed paths, explicit known failures, and lists of tests run and still required. For DB/schema work, avoid a handoff between dependent schema and client changes if a safer checkpoint is reachable. Do not create meaningless commits solely for checkpointing.

### Provider-neutral continuation

Codex is preferred and Claude Code is the fallback implementation agent. For high-risk work, prefer a reviewer from a different model/provider:

- Normal: ChatGPT scope-lock → Codex implementation → Claude hostile review.
- Codex constrained: ChatGPT scope-lock → Claude implementation → fresh Codex review when available.
- Claude constrained: ChatGPT scope-lock → Codex implementation → fresh Claude review when available.

If only one provider is available, use a fresh independent session/context where review is required, state the loss of model diversity, and never let the same session silently self-approve high-risk work. Risk policy wins over provider preference.

### Starting substantial stories

Before starting substantial work, consider story size, risk tier, expected validation burden, and declared or visible usage state. In RED, do not start it. In YELLOW, small coherent work may continue, but large/high-risk work should preferably go to another available agent or wait for sufficient usage. Small docs/test-only work may be safe in YELLOW when it can reasonably reach a complete checkpoint.

## Efficient prompts

Repository documents hold the permanent rules. A task prompt should contain only its baseline, current scope, and exceptions—do not repeat the handbook. Inspect existing primitives before creating infrastructure; reuse proven domain patterns only where semantics genuinely match, not by cargo-culting another domain.

## Frontend milestone

After APP-083, pause ordinary forward feature work for a dedicated iOS frontend/design-system phase before later roadmap stories. The direction is an **Apple-grade iOS redesign**: native iOS hierarchy; a calm first-party feel; consistent typography, spacing, materials, navigation, sheets, and forms across every module; one LifeSort language rather than a pixel-for-pixel Apple clone; and dark mode, Dynamic Type, accessibility, and interaction states designed from the start. Establish design-system primitives before screen-by-screen polish. This workflow does not define that design system.
