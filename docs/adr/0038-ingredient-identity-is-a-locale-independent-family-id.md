# ADR-0038: Ingredient identity is a locale-independent family ID, separate from display text and retailer products

| | |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-09-19 |
| **Owner** | Hajrudin Kardasevic |
| **Story** | APP-047 |
| **Superseded by** | – |

## Context

A recipe ingredient was `{ name: string, amount: string }`. Both identity and
quantity were opaque text: "Æg" and "Eggs" were unrelated strings, "200 g" could
not be summed or compared, and every Food feature that needed "the same
ingredient" (offers, prices, pantry, the weekly plan) matched display names with
lower-case substring tests. The same bundled recipe existed twice, once per
language, with nothing but array position connecting the two.

Existing recipes live in four places, all in that shape: the persisted Food
store (Zustand v0 in every build from 49c4355 to 5c85adc), Supabase
`food_recipes.ingredients` (JSONB), backup files (formats 1–3) and the bundled
seeds. User-entered text such as "1 dåse", "1,5 spsk", "efter smag" or "1.000 g"
cannot be turned into a family or a number without guessing.

## Decision

- **Identity is a family ID** from one catalogue in `core/food/ingredients.ts`:
  stable, locale-independent identifiers such as `egg` or `chicken-breast`. They
  are never derived from display text at runtime, never a retailer product, SKU
  or price row, and never renamed. The catalogue holds exactly the families the
  bundled recipes use. Brand, pack size, fat percentage, "light", cut and packing
  medium are product attributes, not identity.
- **Display is separate.** A recipe ingredient keeps its `name` in the recipe's
  own language. Danish "Æg" and English "Eggs" carry the same `familyId`.
- **Quantity is structured:** a finite number above zero, and a unit from a
  closed vocabulary — `g`, `ml`, `piece` — which is exactly what the bundled
  recipes use. "stk"/"pcs" are labels, not units. There is no conversion engine.
  The contract states no precision limit; what a form accepts as typed text is
  that form's own input policy, and the recipe form's is deliberately narrower
  (one separator, at most two decimals) because typed text is ambiguous between
  locales in a way a stored number is not.
- **Three explicit kinds.** `family` (linked, structured), `unlinked` (a user's
  own ingredient with a structured quantity but no family — the catalogue is
  deliberately small, so "not linked" must be representable) and `legacy` (a
  pre-APP-047 `{ name, amount }`, kept verbatim). New data is only ever `family`
  or `unlinked`.
- **Legacy data is preserved, never interpreted.** Local v0 → v1, backup formats
  1–3 and Supabase rows all map `{ name, amount }` to `legacy` with both strings
  untouched. No family is matched by name, no amount is parsed, even when the
  text equals a seed's. Those same three places may also hold ingredients a newer
  build wrote — an older build caches server rows verbatim and exports them — so
  an element already in the current contract is validated and kept. Any other
  shape fails closed: startup keeps the bytes (ADR-0033), an import is rejected
  whole, a remote row is skipped. Backup format 4 accepts only the current contract.
- **Seed copies are a cache.** Persisted seed recipes (profile D) are refreshed
  from the bundle when the Food store hydrates, which is how pre-APP-047 copies
  regain their families. A seed the user removed stays removed.
- **Substitutions are explicit data** between family IDs
  (`features/food/ingredientSubstitutions.ts`): a registry states, per family,
  which families may replace it, and a pure resolver answers only what the
  registry states — directed, with no symmetry, transitivity, name similarity,
  AI or nutritional reasoning derived. An unregistered pair has no relationship.
  **LifeSort's own registry is empty.** Which ingredient may replace which is
  product content that neither the master specification nor APP-047 defines, so
  the story ships the mechanism and no relationships. Tests exercise the resolver
  against a test registry, which is a fixture and not a claim about food.
- **One validator** decodes every boundary — local state, backup, Supabase and
  the store's own writes — and returns a fresh object with exactly the contract's
  fields. The JSONB columns hold the new shape; no database migration is needed.
- **The contract lives in core** for the reason `core/economy/recurrence.ts`
  does: the local migration and the backup parser are core and must validate it,
  and core may not import a feature (ADR-0003). Substitutions only Food needs, so
  they live in `features/food`.

## Consequences

- Seeds are fully linked; DA and EN recipes share identity ingredient by
  ingredient. The visible recipe text is unchanged.
- New user ingredients need a quantity and one of three units. An amount such as
  "a pinch" or "2 dl" can no longer be typed; the vocabulary can grow when a
  story needs it. The recipe form does not offer family linking yet, so a user's
  new ingredients are `unlinked` rather than guessed.
- Substitution support exists but answers "none" everywhere until a registry is
  filled, so no feature can build on specific relationships yet.
- Backups move to format 4. A build older than APP-047 refuses a format 4 file
  as "newer", as it already did for unknown formats.
- An older build on another device reads the new Supabase rows by `name` and
  shows no amount for them; it never rewrites them, because no older build edits
  a recipe's ingredients in place.
- Offers, prices, pantry and the weekly plan still match on the display `name`,
  exactly as before. Replacing that with family-aware behaviour is APP-048,
  APP-052 and APP-053; no bridge matcher was added here.
- A persisted Food store now fails startup closed on an unknown ingredient shape,
  where it previously hydrated anything. History shows that builds before
  APP-047 created only `{ name, amount }`; the only other shape a v0 store can
  hold is a cached row in the current contract, which is accepted.

## Alternatives considered

- **Derive the family from the name (exact or fuzzy) during migration.**
  Rejected: "Salat" is lettuce in a seed and may be a salad in a user's recipe;
  exact text is still a guess about intent, and a wrong family is worse than none.
- **Parse legacy amounts like "200 g".** Rejected: the same parser would have to
  refuse "1.000 g", "1,5 spsk" and "efter smag", leaving two classes of legacy
  data for no user value. Legacy stays one verbatim kind.
- **Use retailer product or price-row IDs as ingredient identity.** Rejected:
  products are branded, sized and store-specific; a recipe needs "egg", not one
  shop's ten-pack. Linking families to products is a later pricing concern.
- **Separate DA and EN families.** Rejected: that is the problem being solved.
- **Relational `recipe_ingredients` tables.** Rejected for now: JSONB already
  holds the payload, the client validates every boundary, and no query needs
  ingredient rows yet.
- **Infer substitutions by similarity or nutrition.** Rejected: that would be a
  health or dietary claim, and not deterministic.
- **Ship a starter set of substitutions** (wrap ↔ tortilla, lettuce ↔ romaine,
  and so on). Rejected in review: plausible-sounding relationships are still
  invented product content. The mechanism is APP-047's deliverable; the data
  needs an authoritative source and the story that owns it.
- **Keep seeds in legacy form and convert them by exact match in the
  migration.** Rejected: the migration would depend on bundled content; refreshing
  the seed cache on hydration already has an owner and needs no matching.
