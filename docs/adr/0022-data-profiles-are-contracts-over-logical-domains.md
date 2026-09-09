# ADR-0022: Data profiles are contracts over logical domains

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-09 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-027 |
| **Superseded by** | - |

## Context

E3 starts by separating LifeSort data into four storage/sync profiles:

- A - ordinary local-first
- B - sensitive local-first
- C - server-authoritative
- D - global read-only/reference

The tempting shortcut is to attach one profile to each physical store key or
table. The current app disproves that model. `lifesort-food-v2` contains both
user food data and cached/reference catalogue content. `lifesort-cycle` contains
both user health data and reviewed reference content. Expense, warranty and trip
stores contain ordinary records alongside attachment metadata and local file
URIs. A single physical surface can therefore carry more than one policy.

## Decision

Create a centralized TypeScript registry in `core/storage/dataProfileRegistry.ts`
with two separate concepts:

1. Logical data domains. Each domain has exactly one A/B/C/D profile and a
   profile contract: local persistence allowance, encryption requirement,
   authority, normal-client writability, global-reference status and sync
   expectation.
2. Physical persistence surfaces. Each mobile-relevant AsyncStorage key,
   SecureStore key, Supabase table, Supabase Storage bucket, local filesystem
   cache and bundled source lists the domains it currently contains.

Profile assignment is explicit rather than inferred. Unknown domains and
unknown surfaces fail closed: callers get no plaintext permission, unknown
surfaces are treated as possibly containing Profile B data, and exact surface
lookups throw when code asks for domain membership without a registry entry.

The registry records today's mobile storage reality. It does not split stores or
migrate data. The existence of a table in the shared Supabase project is not
enough to make it a mobile APP-027 domain; backend/admin/audit/rate-limit/support
tables stay outside this registry until the mobile client reads, writes, caches
or syncs them. OS integrations such as local notifications, calendar export and
the share sheet are also outside APP-027 unless LifeSort itself stores or caches
state for them.

## Consequences

- Future storage code can ask whether a physical surface contains Profile B data
  without assuming one key equals one policy.
- A weaker domain cannot silently downgrade a mixed container. If any domain in
  a surface requires encrypted local persistence, the surface reports
  `encrypted-required`.
- Inventory tests can block unclassified mobile stores, client-referenced
  tables and mobile storage buckets before they become new hidden data surfaces.
- The code-level registry is testable without Supabase or network access.
- Some classifications remain explicit human-review risks, especially career
  notes and CV content.

APP-027 intentionally does not implement APP-028 encrypted health storage,
APP-029 sensitive document cache, APP-030 cryptographic UUID changes, APP-031
durable outbox, APP-032 idempotency, APP-033 revisions/`updated_at`, APP-034
tombstones, APP-035 conflict handling, APP-036 sync UX, APP-037
connectivity-aware sync or APP-038 migration harness.

## Alternatives considered

**One profile per persisted store key.** Rejected because it would misclassify
`lifesort-food-v2`, `lifesort-cycle`, and stores that carry attachment metadata.

**Store the registry in Supabase.** Rejected for APP-027. The specification asks
for a platform contract and does not require persisted registry state. A
code-level registry is easier to type-check, review and test offline.

**Register every migration-created table.** Rejected because APP-027 is the
mobile storage/sync registry. Backend-only schema such as admin users, audit
logs, timeline events, rate-limit counters, support tickets and waitlist signups
are documented as outside the mobile registry instead of being modeled as mobile
data domains.

**Register every OS side effect.** Rejected because an integration is not a
persistence surface by itself. Local notifications, calendar export and the
share sheet can matter to privacy and UX stories, but APP-027 only tracks places
where LifeSort data is stored, cached or canonically retained.

**Classify everything financial or document-adjacent as Profile B.** Rejected.
The APP-027 guidance distinguishes user-created financial records from
server/provider facts, and warranty records from sensitive attachment files.

**Wait until encryption/outbox work.** Rejected because later E3 stories need a
shared vocabulary before they can migrate safely.
