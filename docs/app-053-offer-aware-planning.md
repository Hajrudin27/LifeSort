# APP-053 — Offer-aware planning

## Baseline and audit

APP-048 already distinguishes current, stale, upcoming, and unknown-freshness
price evidence using Copenhagen calendar dates. APP-049 consumes that evidence
for budget assessment. APP-052 gives generated shopping requirements typed
family identity without making Pantry family-aware. The existing catalogue joins
offers through `global_standard_prices` to `products`; it previously had neither
an ingredient-family mapping nor publication/licence metadata and the planner
matched global offers by display-name substring.

The repository did not contradict the locked assumptions. Catalogue tables have
RLS, authenticated read policies, and admin-only write policies. Standard prices
have no freshness timestamp suitable for a current-price claim. Food's direct
Supabase reads and APP-052's sequential base/child writes remain existing debt.

## Locked contract and schema

The additive migration `20260924222846_offer_aware_planning.sql` adds nullable
`products.ingredient_family_id` and adds `published`, `licence_cleared`, and
nullable nonblank `member_condition` to `global_offers`. Both booleans are
non-null and default false. Existing content is not backfilled, so it remains
unmapped, unpublished, and uncleared until explicit admin curation. RLS is the
authoritative eligibility boundary: ordinary authenticated readers can select
only rows where both flags are true. A separate permissive policy lets existing
owner/editor content admins read every offer for curation; support receives no
additional privilege. Product and global-standard-price RLS remains unchanged.

Family identity and catalogue product identity stay separate. A family recipe
ingredient matches a global price or offer only when its `familyId` equals the
product's validated explicit mapping and the store is selected. Labels never
create a family link. Unlinked and legacy ingredients cannot receive global
offers; their narrow historical standard-price name fallback remains unknown
freshness and cannot create APP-053 opportunities.

The store query requests only published and licence-cleared offer rows, and the
decoder independently rejects rows that are draft, uncleared, malformed, have an
unknown non-null family, a blank member condition, or a broken linked standard
price. Those client checks are defense in depth. Database row visibility also
protects older clients that select only legacy offer columns and do not know the
new predicates. The Food persistence version remains 3; incompatible cached
global catalogue shapes are ignored rather than migrated or inferred.

## Planning, comparisons, and UI

Only a current, unrestricted, authoritative family offer can become an automatic
planner price. Conditional offers remain visible with their exact requirement
but never become an assumed effective price or prove budget fit. APP-048's
existing evidence function is the sole freshness implementation.

The pure offer-aware read model accepts typed shopping requirements and normalized
global offers. It returns at most one deterministic positive comparison per
family in selected stores, preferring an unrestricted candidate. Each result
contains its family and display label, catalogue product, store, offer and linked
reference price, dates, condition, automatic eligibility, and an explicit
unknown reference-freshness flag. It is never persisted.

The weekly plan shows each current opportunity, its campaign dates, store,
condition, potential difference, and reference-price limitation. It reports no
grand total. The Offers screen continues to show current campaigns only and now
shows member conditions and the reference qualification. Neither surface changes
the generated plan or shopping artifacts merely to present the projection.

Comparisons use `reference price - offer price` only when positive. They are not
multiplied by recipe quantity because catalogue products do not provide the pack
size and unit coverage needed to calculate package count. The UI never promises
a guaranteed saving or plan-wide basket saving.

## Verification and limitations

Focused tests cover decoder and store gates, exact nested selects, family-only
matching, store isolation, member conditions, APP-048 date boundaries, positive
comparisons, deduplication, no quantity multiplication, planner regressions, and
DA/EN UI wording. A disposable local PostgreSQL test applies the actual migration
and checks columns, defaults, the nonblank constraint, the existing offer FK,
and actual row visibility for ordinary authenticated, support, owner/editor, and
anonymous sessions using an old-client-shaped query. It also exercises the
unchanged owner/editor write boundary rather than relying only on policy names.

The migration is repository-only and was not applied remotely. Existing rows
need explicit admin mapping and publication/licence curation. There is no user
membership model, pack-size/unit coverage, exact basket optimization, ingestion
pipeline, Pantry family mapping, or purchase/order flow. Reference standard-price
freshness remains unknown. APP-052 provenance and sequential sync remain
unchanged.
