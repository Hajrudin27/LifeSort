# ADR-0042: Offer-aware planning requires explicit family mapping and eligibility

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-24 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-053 |
| **Superseded by** | – |

## Context

Recipes use a canonical ingredient-family identity, while retailer catalogue
products have their own product identity. Display names can vary by language or
refer to similar but different ingredients, so text matching cannot establish a
catalogue relationship. Catalogue offers also need an explicit publication and
licence decision, and the app has no model of a user's retailer memberships.
APP-048 already owns campaign-date freshness and treats undated standard prices
as having unknown freshness. APP-052 shopping artifacts are persisted snapshots
with separate provenance and must not become offer storage.

## Decision

- `products.ingredient_family_id` is a nullable, explicit mapping to the existing
  family vocabulary. It does not replace either product or family identity, and
  no name, locale, SKU, barcode, or fuzzy match may infer it.
- A global offer is authoritative only when both `published` and
  `licence_cleared` are true. Historical rows default to false and therefore
  fail closed until an admin curates them.
- RLS is the authoritative eligibility boundary for ordinary authenticated
  catalogue readers. Its normal SELECT policy exposes only rows where both
  eligibility flags are true, including to older clients that request only the
  pre-APP-053 columns. A separate permissive SELECT policy lets owner/editor
  content admins read draft and uncleared rows for curation; support is not
  added to that policy. New-client query predicates and strict decoding remain
  defense in depth.
- APP-048 remains the sole campaign-freshness rule. Only current unrestricted
  offers may price automatic planning. `member_condition` is shown verbatim;
  conditional offers may be presented as opportunities but are never assumed
  to be the user's effective price.
- An offer comparison is the linked standard price minus the offer price. The
  result is called potential because reference-price freshness is unknown.
  Comparisons are not multiplied by recipe quantity or added into a guaranteed
  basket total because package-size and unit coverage do not exist.
- The opportunity list is a pure, non-persisted projection with at most one
  deterministic result per family and selected-store scope. APP-052 shopping
  artifacts and provenance remain unchanged.

## Consequences

The catalogue must be deliberately mapped and approved before it influences the
planner. Ordinary users cannot read draft or unlicensed offers even through an
older client or direct predicate-free catalogue query. Owner/editor can still
curate those rows. Unmapped, stale, and future offers cannot become current
planning prices. Member requirements and campaign dates remain visible, while
budget assessment continues to use its existing evidence semantics. No local
Food persistence version change is needed because stale cached global rows fail
the stricter runtime decoder.

## Alternatives considered

- Match product and ingredient display names: rejected because labels are
  presentation, vary by locale, and cannot establish identity.
- Treat product IDs or retailer SKUs as ingredient-family IDs: rejected because
  a retail product and a canonical ingredient are different entities.
- Assume all published member offers apply: rejected because the product has no
  membership-entitlement model.
- Multiply by recipe quantities or report a weekly savings total: rejected
  because catalogue rows do not state authoritative pack-size/unit coverage.
- Store offer facts in APP-052 provenance: rejected because offer availability
  is a changing read projection, while shopping provenance is immutable source
  trace.
