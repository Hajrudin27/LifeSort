# APP-074 — Governed clinical reference content (P0)

APP-074 makes the shared Cycle condition and symptom library fail closed until a complete editorial lifecycle has
published it. It does not change the corpus's medical claims (APP-075), add Pregnancy (APP-076), or create an admin
interface in this repository.

## Database contract

`health_conditions` and `symptom_glossary` have stable logical `id`s plus immutable UUID `revision_id`s and positive
`content_version`s. Old entries are v1 `draft` with null provenance/review/publication metadata. A partial unique
index permits one published revision per logical ID.

The states are `draft`, `in_review`, `published`, and `withdrawn`. Owners/editors create/edit drafts, submit, approve
review, and return work. Only owners publish/withdraw. Review completion is `reviewed_by`/`reviewed_at` on an
`in_review` row; the authenticated reviewer is derived in the database, and v1 permits self-review without calling it
independent clinical review.

Publication validates sources, complete DA/EN content, positive version, nonexpired Copenhagen review date, and prior
review. A replacement withdraws the prior current revision in the same transaction. Every lifecycle action appends a
safe actor/action/revision audit row; no article body, Cycle log, or other user-health payload enters the audit log.

Ordinary authenticated reads are RLS-limited to `published` rows whose `review_due_at` is at least Copenhagen's current
date. Direct authenticated table writes are revoked. Authorized editorial reads/writes go through narrow table-specific
security-definer RPCs with fixed search paths and internal role checks. The external LifeSort admin platform must adopt
those RPCs; no admin UI is supplied here. `activity_log` is `SELECT`-only for API roles (including `TRUNCATE` revoked).

## RPC contract for the external admin platform

Every function is `SECURITY DEFINER` with `search_path = ''`, derives the actor from `auth.uid()`, and is executable
only by `authenticated` (never `anon`, `PUBLIC` or `service_role`). The role check is inside the body. `revision_id`
is the row identity; `id` is the logical id and is only an argument when creating the first revision.

| Operation | Health conditions | Symptom glossary | Roles |
| --- | --- | --- | --- |
| Read every revision (all states) | `admin_list_health_condition_revisions()` | `admin_list_symptom_glossary_revisions()` | owner, editor |
| Create v1 draft | `admin_create_health_condition_draft(id, 11 DA/EN fields, source, url, review_due_at)` | `admin_create_symptom_glossary_draft(id, 4 DA/EN fields, source, url, review_due_at)` | owner, editor |
| Create next revision (copies content, resets evidence) | `admin_create_next_health_condition_revision(revision_id)` | `admin_create_next_symptom_glossary_revision(revision_id)` | owner, editor |
| Edit a draft | `admin_update_health_condition_draft(revision_id, …)` | `admin_update_symptom_glossary_draft(revision_id, …)` | owner, editor |
| Submit for review | `admin_submit_health_condition_for_review(revision_id)` | `admin_submit_symptom_glossary_for_review(revision_id)` | owner, editor |
| Approve review (sets `reviewed_by`/`reviewed_at` from the caller) | `admin_approve_health_condition_review(revision_id)` | `admin_approve_symptom_glossary_review(revision_id)` | owner, editor |
| Return to draft (clears review evidence) | `admin_return_health_condition_to_draft(revision_id)` | `admin_return_symptom_glossary_to_draft(revision_id)` | owner, editor |
| Publish (replaces the current revision atomically) | `admin_publish_health_condition(revision_id)` | `admin_publish_symptom_glossary(revision_id)` | owner |
| Withdraw | `admin_withdraw_health_condition(revision_id)` | `admin_withdraw_symptom_glossary(revision_id)` | owner |

Failures are stable error codes: `clinical_not_authorized`, `clinical_owner_required`, `clinical_revision_not_found`,
`clinical_draft_not_found_or_immutable`, `clinical_review_not_pending`, `clinical_review_not_found`,
`clinical_publication_requires_review`, `clinical_publication_prerequisites_not_met`,
`clinical_unknown_symptom_logical_id`, `clinical_published_revision_not_found`, `clinical_logical_id_required`,
`clinical_logical_id_exists_use_next_revision` (plus `not_authenticated` from the audit helper when no session exists).

Known v1 behaviours the admin platform should account for: a condition's `common_symptoms` are validated to be existing
symptom logical ids (any revision state), not necessarily *published* ones, and the mobile app omits a symptom that is not
in the published glossary; and publication has no monotonic-version guard, so publishing an older in-review revision
replaces a newer published one (owner-only action).

## Mobile/cache behavior

The mobile query selects only presentation and eligibility fields, duplicates the published/unexpired predicate as
defence in depth, and validates rows before state insertion (including that `review_due_at` is a real `YYYY-MM-DD`
date). The two related collections replace together only after a complete successful result; a smaller or empty result
is authoritative. A non-persisted runtime gate means encrypted legacy or stale cache never renders after launch,
failed/partial/throwing refresh, logout, or account switch. The persisted reference rows are never hydrated into runtime
state (the store's `merge` keeps the in-memory values), so a disk read that finishes after a governed refresh cannot
replace it or claim readiness. The two screens gate outside their store selectors; a selector returning a fresh `[]`
would be an unstable snapshot and loop.

## Rollback posture

Do not roll back by re-exposing legacy content. If a later defect occurs, fail closed and ship a forward migration/fix.
Physical iPhone QA remains required before release approval.
