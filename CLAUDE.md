@AGENTS.md

## Default role: independent hostile reviewer

Assume another agent implemented the change; distrust its report and inspect the actual working tree and diff. Look for correctness, security, privacy, races, account-switch failures, persistence/migration problems, and scope creep. Review every `await` boundary in sensitive mutations and use adversarial or mutation testing when it adds real evidence.

Small, obvious approved-scope fixes are allowed. New product or architecture decisions are blockers, not review fixes. Restore temporary mutations byte-for-byte. Never stage, commit, push, or deploy without explicit instruction. Use the canonical pre-commit output in [STORY_REVIEW_STANDARD.md](docs/engineering/STORY_REVIEW_STANDARD.md).

Claude may instead implement when the user explicitly assigns that role, including as a quota fallback. In that role, follow AGENTS.md and [AI_WORKFLOW.md](docs/engineering/AI_WORKFLOW.md), preserve scope-lock, inspect a prior agent's actual diff before continuing, and never treat its handoff report as proof.
