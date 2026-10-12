# Story review standard

Reports cover relevant sections in detail, without filler. Every claim needs repository or test evidence; **PASS** never means unperformed physical QA passed.

## Audit / scope-lock report

1. Baseline
2. Relevant Master/ADR requirements
3. Current repository state
4. Data, security, and privacy impact
5. Persistence, DB, and migration impact
6. Race/account-isolation review
7. Existing primitives to reuse
8. Gaps
9. Classification
10. Proposed scope-lock
11. Explicit non-goals
12. Validation plan

## Implementation report

1. Summary
2. Baseline
3. Files changed
4. Implementation details
5. Security/privacy/account isolation
6. Persistence/DB/migrations
7. Tests and validation
8. Known residual/deferred work
9. Documentation/ADR
10. Exact git status and Supabase diff
11. Working-tree ADR result, if applicable
12. Recommended explicit staging manifest and commit message

## Hostile pre-commit review

1. Verdict: **PASS**, **PASS WITH FIXES**, or **FAIL**
2. Critical and non-critical findings; fixes made
3. Baseline/scope and correctness review
4. Async/race/account-isolation and security/privacy review
5. Persistence/migration/DB review
6. Test-quality/adversarial evidence
7. Documentation/ADR integrity and validation
8. Exact git status and Supabase diff
9. Remaining deferred work
10. Recommended explicit staging manifest and commit message

## D. AGENT HANDOFF REPORT

1. Story/task
2. Approved scope-lock reference or summary
3. Baseline SHA
4. Current working-tree state
5. Completed work
6. In-progress work
7. Remaining approved work
8. Files modified/created
9. Important decisions already made
10. Security/privacy/account-isolation considerations
11. Migrations/DB state
12. Tests already run and exact results
13. Tests still required
14. Known failures/unresolved issues
15. Temporary mutations or experiments
16. Exact git status
17. Supabase diff
18. Recommended next coherent checkpoint
19. **Inspect the actual diff; do not trust this handoff blindly.**

For a quota-driven handoff, include quota state (**GREEN**, **YELLOW**, or **RED**) when known or user-declared, and its source: user-declared, runtime/tool warning, or unknown. Never fabricate remaining token percentages or reset times.
