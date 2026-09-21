# ADR-0039: Price freshness requires authoritative temporal provenance

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-21 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-048 |
| **Superseded by** | – |

## Context

The Food lookup returned price/store/source or null. The planner summed known
prices and exposed the result as an approximate full cost. Standard catalogue
reads still requested `product_name`, removed by the products migration.
The master specification §8.2 and APP-048 require honest price uncertainty.

## Decision

One `PriceEvidence` union owns price-read semantics in `utils/food/priceEvidence.ts`.
Campaign evidence has source, store, price, validFrom/validTo and a derived
current, stale (expired), or upcoming state. Campaign boundaries are inclusive
Copenhagen dates using the shared APP-045 primitive and an explicit reference
instant. Future campaigns are explicitly upcoming, never stale or current.

Standard prices have unknown freshness. The repository's `updated_at DEFAULT
now()` does not establish when a price was observed or published. Personal
manual/imported offer week tags likewise do not prove campaign validity. No
fetch/cache timestamp is price provenance. Unavailable evidence has no numeric
price, source claim about a retailer, or fabricated date.

Current campaigns take precedence, then undated standard prices. If neither
exists, expired/upcoming campaigns may explain unavailability but do not enter
the known-price subtotal. Missing prices do not become zero. Aggregate reads
carry current/partial/unavailable status and separate uncertainty counts.
A current result means every required shopping entry has current evidence;
it does not guarantee quantity coverage or budget fit.

Catalogue reads follow `global_offers.standard_price_id` to
`global_standard_prices.product_id` to `products.id/name`. Unknown remote rows
are decoded and malformed rows rejected, including invalid joins, price values,
source values and campaign dates. Existing cache shapes remain unchanged and
price consumers validate cached price/campaign fields before interpreting them.
No storage migration or remote schema change is needed.

Display-name matching remains a compatibility limitation. Ingredient family
identity is never retailer product identity. No inferred family/product mapping
is introduced. APP-049 allocation, APP-050 pantry changes, APP-051 suggestions,
APP-052 family/unit merging and APP-053 full offer-aware planning stay deferred.

## Consequences

- Undated standards can contribute only to a clearly labeled partial subtotal.
- Expired/future amounts can be displayed as dated evidence but are excluded
  from totals. A wholly unpriced requirement has a null subtotal, not zero.
- The existing greedy planner still ranks candidates by their known subtotal;
  it does not certify budget fit. UI states this and the existing quantity and
  name-matching limitations explicitly.
- Visible plans re-evaluate prices when catalogue/store/pantry inputs change,
  on app resume and every 30 seconds. Chosen recipes and empty slots are kept.
- Store summaries describe assigned entries only; missing prices cannot be
  assigned to a retailer. The overall summary retains those missing portions.
- DA/EN presentation exposes source, retailer scope and campaign dates without
  claiming market-wide, live or nationwide coverage.

## Alternatives considered

- Treat `updated_at`, fetch time or a fixed age threshold as freshness: rejected,
  because these are not authoritative observations in this repository.
- Hide expired evidence as an undifferentiated null: rejected because expired
  evidence and absent provenance are different facts.
- Sum all remembered campaign prices: rejected because an expired/future price
  does not support today's subtotal.
- Redesign matching or adopt an external catalogue schema: deferred; the locked
  mobile schema and APP-048 scope support a narrow read-boundary repair.
