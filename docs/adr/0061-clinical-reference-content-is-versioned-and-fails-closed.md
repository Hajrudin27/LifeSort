# ADR-0061: Clinical reference content is versioned and fails closed

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-10-13 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-074 |
| **Superseded by** | – |

## Context

Cycle condition and symptom-reference rows were shared editorial content, but had no source, review date,
expiry, revision identity, or trustworthy editorial mutation boundary. Historical seeds therefore cannot truthfully
be treated as reviewed medical reference material.

## Decision

- `id` remains the stable product logical ID; `revision_id` is a UUID primary key for one immutable editorial
  revision; `(id, content_version)` is unique. `common_symptoms` continues to hold symptom logical IDs.
- Revisions use `draft`, `in_review`, `published`, and `withdrawn`. A completed review is represented by
  server-derived `reviewed_by` and `reviewed_at` while the row remains `in_review`.
- Owners and editors may draft, edit, submit, review, and return work. Owners alone publish or withdraw. Self-review
  is allowed in this v1 small-team model, but is not represented as independent or medically qualified review.
- Publication is a distinct owner-only transition and requires nonblank source reference, bilingual complete content,
  a future-or-current Copenhagen `review_due_at`, and recorded review evidence. Replacing a published revision
  withdraws the old revision atomically.
- Ordinary RLS exposes only published, unexpired rows, including to owner/editor accounts. Role-checked, narrow
  `SECURITY DEFINER` RPCs provide editorial reads and lifecycle mutations. They use a locked search path and append
  safe operational audit evidence atomically to the existing append-only activity log.
- All legacy rows become version 1 drafts with no fabricated source, reviewer, review time, due date, or publish time.
  A database deployment with no later editorial action therefore correctly presents an empty reference library.
- `cycle.reference-content` remains Profile D. Its encrypted physical Cycle cache may remain, but a non-persisted
  runtime gate prevents any cached or legacy value from rendering until both published collections refresh completely
  in the current authenticated session. Expiry and a failed/partial refresh fail closed. Persisted reference rows are
  never hydrated into runtime state (the store's `merge` keeps the in-memory values), because the Cycle fetch is not
  gated on hydration: a late disk read must neither replace a governed refresh nor claim readiness.
- The audit trail is `public.activity_log`. API roles keep `SELECT` only on it: every lifecycle row is appended by the
  definer RPCs, and `TRUNCATE` is revoked along with the DML privileges because RLS does not apply to it.

## Consequences

The external LifeSort admin platform must use the APP-074 RPC contract before normal editorial operation is
convenient; this mobile repository deliberately contains no admin UI or privileged client secret. Database rollback
must not restore legacy unreviewed content: use a forward fix or fail-closed module/content posture instead.

APP-074 governs whether reference content may be exposed and whether its governance evidence is current. APP-075
separately owns what medical, contraceptive, or diagnostic claims are permitted; APP-076 owns Pregnancy.

## Alternatives considered

- **Grandfather existing seeds as published.** Rejected: provenance and review evidence do not exist.
- **Let admins write tables directly through broad RLS.** Rejected: REST could bypass lifecycle, review and audit.
- **Persist a successful refresh marker.** Rejected: a process/session restart could render an expired or withdrawn
  cache without a fresh authoritative result.
- **Add a generic CMS mutation RPC or an admin mobile screen.** Rejected: the approved boundary is typed,
  table-specific database operations; the operational admin application is external.
