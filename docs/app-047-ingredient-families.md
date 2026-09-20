# APP-047 ingredient family model

**Story:** APP-047 (E5 · Food & grocery, P0) — *As the recipe system I want recipes to link generic ingredients, not random branded SKUs.*
**Acceptance:** family IDs; quantities/units structured; substitutions supported.
**Decision:** [ADR-0038](./adr/0038-ingredient-identity-is-a-locale-independent-family-id.md)
**Baseline:** `main` at `5c85adc`.

A recipe ingredient used to be `{ name: string, amount: string }`: identity and
quantity were both opaque text, and the Danish and English copies of the same
bundled recipe shared nothing but their array position. APP-047 gives
ingredients a canonical identity and a structured quantity. It does not change
how prices, offers, the pantry or the weekly plan match ingredients.

## The contract

`core/food/ingredients.ts` is the one implementation. It depends on nothing.
It sits in core, like `core/economy/recurrence.ts`, because the local migration
and the backup parser are core and must validate it (ADR-0003, C2 note in
[core-contract.md](./core-contract.md)).

```ts
type RecipeIngredient =
  | { kind: 'family'; familyId: IngredientFamilyId; name: string; quantity: number; unit: IngredientUnit }
  | { kind: 'unlinked'; name: string; quantity: number; unit: IngredientUnit }
  | { kind: 'legacy'; name: string; amount: string };
```

| Concept | Rule |
| --- | --- |
| Family ID | One of `INGREDIENT_FAMILY_IDS`: readable, locale-independent identifiers (`egg`, `chicken-breast`). Never derived from display text at runtime, never a retailer product, SKU, `products` or `global_standard_prices` ID, never renamed. |
| Catalogue | Exactly the 71 families the bundled recipes use — a test fails if a family is unused or a seed uses one outside it. No grocery ontology. |
| Family granularity | Brand, pack size, fat %, "light", cut and packing medium are attributes, so "Laksefilet" and "Laks" are `salmon`, "Kartoffel" and "Kartofler" are `potato`, "Mælk 1,5%" is `milk`. A variety or processed product sold as its own item is its own family: `cherry-tomato`, `romaine-lettuce`, `ground-beef`, `chopped-tomatoes`. |
| `name` | Display text in the recipe's language. Presentation only; nothing uses it as identity. |
| Quantity | A finite number above zero. The contract sets no precision limit; a form's input policy is its own (see below). |
| Unit | `g`, `ml` or `piece` — exactly what the seeds use. "stk"/"pcs" are labels (`food.units.*`), not units. There is no conversion between units. |
| `family` | Linked to a family. Every bundled seed ingredient. |
| `unlinked` | A user's own ingredient with a structured quantity but no family. The catalogue is deliberately small, so "not linked" is a state, not a guess. |
| `legacy` | A pre-APP-047 `{ name, amount }`, kept verbatim. Only ever produced from old data. |

`decodeRecipeIngredient` validates one value and returns a fresh object with
exactly the contract's fields, or null: extra keys, an unknown kind, family or
unit, a blank name and an invalid quantity are rejected, never repaired.
`familyIngredient` and `unlinkedIngredient` are the only constructors and throw
`IngredientError('ingredient_invalid')` rather than build an invalid value.

`parseIngredientQuantityInput` is the recipe form's **input policy**, not the
contract: it accepts one comma or dot and at most two decimals, so "1.000" and
"1,500" — thousands in one locale, decimals in the other — are refused rather
than guessed. Typed text is ambiguous between locales in a way a stored number is
not, so a quantity that reaches the app any other way is held only to the
contract.

`formatIngredientAmount` renders an ordinary quantity as a localized decimal
with exactly the decimals the number has ("3", "1,5", "1.005"). A fixed decimal
rendering cannot state every number the contract allows, so quantities below
about 1e-20 — which would round to "0" — and above 1e21 — which would spell out
hundreds of digits — render as localized scientific text ("5e-324",
"1,7976931348623157e+308") instead. Both branches are deterministic, and a valid
quantity is never shown as zero or at another magnitude.

## Substitutions

`features/food/ingredientSubstitutions.ts` holds a registry type and a pure
resolver. A registry states, per family ID, which families may replace it;
entries are directed, so both directions are written where both hold.
`substitutesIn(registry, familyId)` and `isSubstituteIn(registry, a, b)` answer
only what that registry states — no symmetry, transitivity, name similarity,
product matching, AI or nutritional reasoning — and anything unregistered has no
substitute. `substitutesFor` / `isRegisteredSubstitute` are the same questions
asked of LifeSort's own registry.

**LifeSort's registry is empty**, so every lookup answers "none" today. Which
ingredient may replace which is product content, and neither the master
specification nor APP-047 defines a single relationship; inventing plausible ones
in code would make LifeSort assert culinary facts it has no source for. The
registry stays empty until authoritative substitution data exists, and the story
that brings that data owns it. The tests exercise the resolver against a test
registry, which is a fixture and not a claim about food.

There is no substitution UI; APP-047 provides the domain support only.

## Seeds

`data/seedRecipes.da.ts` and `.en.ts` build every ingredient with
`familyIngredient(familyId, name, quantity, unit)`. Tests prove that DA and EN
share family, quantity and unit ingredient by ingredient, and that every name
and amount equals what 5c85adc shipped ("3 stk"/"3 pcs" → `3 piece`), so no
visible recipe text changed. Seed IDs and every other recipe field are untouched.
The name→family table used to author them is not in the app: nothing at runtime
maps names to families.

## Existing data

| Where | Old shape | APP-047 handling |
| --- | --- | --- |
| Local Food store `lifesort-food-v2` | Zustand v0, every ingredient `{name, amount}` | Versioned v0 → v1 (`core/storage/migrations/foodIngredients.ts`) before hydration: `{name, amount}` → `legacy`, verbatim. |
| Persisted seed copies | Same, inside the local store | Migrated to `legacy` like everything else, then refreshed from the bundle when the store hydrates (`refreshSeedRecipes`), as the language reseed already did. A removed seed stays removed. |
| Supabase `food_recipes.ingredients` (JSONB) | `{name, amount}` from every earlier build | Decoded per row with `decodeCompatibleRecipeIngredients`; never cast. A row in neither shape is skipped and reported with a fixed code; the server copy is left alone. |
| Backup files | Formats 1–3 carry `{name, amount}` | Format 4 is written now. Formats 1–3: `{name, amount}` → `legacy`. Format 4: only the current contract. Anything else rejects the whole import. |

No family is ever matched from text and no amount is ever parsed, even when a
user's "Æg" / "3 stk" is identical to a seed's.

**Mixed shapes across builds.** A build older than APP-047 caches Supabase rows
verbatim — in its v0 local store and in the backups it exports — so after an
APP-047 device writes a recipe, an older device can hold the new shape. v0 state,
backup formats 1–3 and Supabase rows therefore accept, per element, either the
pre-APP-047 shape or the current contract (validated). The older build itself
reads new rows by `name` and shows no amount; it never rewrites them, because no
older build edits an existing recipe's ingredients.

**Fail closed.** An unknown shape in local v0 or v1 state keeps startup closed
with the bytes untouched (ADR-0033). The fixture
`__tests__/fixtures/local-migrations/food/5c85adc-v0.json` holds real v0 bytes
from the last pre-APP-047 writer, including "1 dåse", "1,5 spsk", "1.000 g",
"efter smag" and an empty amount.

**No database change.** Both `food_recipes.ingredients` and
`global_recipes.ingredients` are JSONB and hold the new shape as is. The mobile
app does not read `global_recipes`; when it does, the same decoder applies. No
migration file was added and nothing was run against a remote project.

## Screens

- **New recipe** (`app/food/recipes/new.tsx`): each row has a name, a quantity
  (`decimal-pad`) and a unit chip (g / ml / stk, labelled for screen readers).
  A named row needs a valid quantity before the recipe can be saved, and a hint
  says so. Rows are saved as `unlinked`: the form never guesses a family from the
  typed name, and does not yet offer a family picker.
- **Recipe detail** renders `formatIngredientAmount`: "1,5 stk" / "1.5 pcs" for a
  structured quantity (scientific text for extreme magnitudes, see above), and a
  legacy amount exactly as written.
- The store validates every ingredient on `addRecipe`/`updateRecipe` before any
  state or server write, and `recipeToRow` sends exactly the contract's fields.

## Deliberately not done here

- **Matching is unchanged.** Recipe offers (`utils/food/recipeMatching.ts`),
  price lookup (`priceLookup.ts`), pantry coverage and shopping-list
  de-duplication (`mealPlanning.ts`) still compare the display `name` with
  lower-case substring tests, exactly as before. That means, for example, that
  "Kartoffel" and "Kartofler" still become two shopping-list lines although they
  share the `potato` family. Family-aware behaviour belongs to APP-048 (price
  freshness), APP-050/051 (pantry), APP-052 (shopping-list derivation, "merge
  duplicates by family/unit") and APP-053 (offer-aware planning). No bridge
  matcher was added.
- **Families are not linked to products or prices.** How a family maps to
  `products` / `global_standard_prices` is a pricing decision for APP-048/053.
  (Separately, the app still selects `global_standard_prices.product_name`,
  which a 2026-09-05 server migration dropped; that is pre-existing and untouched.)
- **No family picker, no substitution UI, no new units** (kg, l, dl, tsk) and no
  "to taste" amount without a number. Each can be added by the story that needs
  it; the unit vocabulary is a closed list on purpose.
- Food money, pantry quantities (still free text), nutrition (APP-054) and sync
  (still best-effort direct writes) are unchanged.
