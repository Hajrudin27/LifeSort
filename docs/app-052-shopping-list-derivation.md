# APP-052 — Shopping list derivation

The shopping list is a persisted, user-edited snapshot of the occupied weekly
meal-plan slots. Pressing **Generate shopping list** derives one requirement per
canonical source identity. Empty slots contribute nothing. The existing planner
shopping and price views remain compatibility views; they are not the source of
persisted shopping identity.

Family ingredients merge only when both `familyId` and `unit` match, summing
their structured quantities without conversion. Unlinked and legacy ingredients
use `recipeId` plus `ingredientIndex` as their source identity: a repeated plan
slot aggregates the same definition, while matching labels in different recipes
remain separate. Legacy amount text is preserved verbatim, with an explicit
repetition count; it is never parsed. Pantry is not subtracted, reserved, or
changed. Manual shopping items stay manual, including those with a matching
generated label.

Each generated item carries a `weekKey`, typed identity, editable current amount,
and an immutable contribution array. Each contribution records recipe ID, day,
meal type, ingredient index and name, and original structured quantity/unit or
legacy amount. Recipe ID remains authoritative when a recipe is renamed,
translated, or deleted. The UI shows the current amount and an expandable
per-slot source trace, using neutral wording for a missing recipe. Editing
label, amount, or checkbox changes only the shopping artifact. Deletion removes
the artifact and, through the server FK, its derivation row.

Generation stores the current snapshot; later plan edits do not alter it.
Generating again for a week with existing generated items requires confirmation.
Only that week's generated items are replaced. Manual items and generated items
for other weeks survive.

The unchanged AsyncStorage key `lifesort-food-v2` has Food schema v3. The v2→v3
migration converts old `{id,label,checked}` shopping items to explicit manual
items without inferring family, amount, week, or provenance. Backup format v6
makes the same conversion for formats 1–5 and strictly validates current items.
Remote data uses `food_shopping_items.source_kind` and the owner-scoped child
`food_shopping_item_derivations`. An old-shaped base upsert is tested to retain
the derived discriminator and child. Remote decoding rejects all shopping rows
on missing or malformed derivation rather than partially merging them.

The SQL migration is repository-only. It was tested against a fresh disposable
PostgreSQL cluster; it has not been run against a Supabase project. Client sync
still makes separate base and child writes, so a transient failure can leave an
incomplete remote pair until retried; the read path fails closed and records a
privacy-safe error code. Existing account deletion removes the base through the
user-owned cascade and the child through its base FK. Local logout sweeps the
whole Food key; exported backup files remain under the existing user-owned
backup policy.
