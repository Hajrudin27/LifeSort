# LifeSort — Home Snapshots

**Story:** APP-011 (E1 · Module registry & Home, P0)
**Owner:** Hajrudin Kardasevic
**Code:** [`core/modules/homeSnapshots.ts`](../core/modules/homeSnapshots.ts), [`features/homeSnapshots.ts`](../features/homeSnapshots.ts)
**Enforced by:** `__tests__/homeSnapshots.test.ts`

## Why

Home imported eleven domain stores. It knew what an `Expense` looked like, how a
cycle is predicted and how a trip is sorted — so none of those modules could be
changed, disabled or tested without Home. It was the single worst coupling in
the repository, baselined by APP-003 as ten of its forty-one edges.

Home now asks each module for a small, typed card and knows nothing else about
it.

## The shape

```ts
interface HomeSnapshot {
  moduleId; titleKey;
  value? | valueKey? + valueParams?;   // at most one of the two
  helperKey?; helperParams?;
  priority: 'normal' | 'important' | 'urgent';
  sensitivity: DataSensitivity;
  route;
}
```

Two additions to specification §4.1's shape, both for the same reason — **a
module must never guess the user's language, and the shell must never parse a
string**:

- `helperParams` / `valueParams` carry the numbers that a translated sentence
  interpolates.
- `valueKey` is for values that need translating ("In 5 days"). `value` stays for
  values that look the same in every language (an amount). Setting both is a
  contract error, and a test rejects it.

## How the pieces avoid each other

Core may not import a feature (ADR-0003), and Home may not import a module's
store (ADR-0002). So the modules are handed in by the shell, which is the one
place composition belongs:

```
features/<module>/homeSnapshot.ts   reads its own store, returns a card
features/homeSnapshots.ts           the map — the only file that knows all four
core/modules/homeSnapshots.ts       filters by enabled + released, resolves
app/(tabs)/index.tsx                renders cards, owns icons and colours
```

Presentation stays in the shell. A module says *what*; Home decides *how it
looks*. That is why there is no `icon` or `color` in the contract.

A provider that throws is skipped, not fatal: one broken module must not blank
Home.

## §3 Sensitive field review

Required by the acceptance criteria. Every field that reaches the screen, what
it exposes, and what a shoulder-surfer would learn.

| Module | Shown | Sensitivity | Review |
| --- | --- | --- | --- |
| `economy` | Money left this month; percent towards savings | `financial` | An amount and a percentage. No merchant, no category, no transaction. The amount alone reveals rough income — enough to want the masking in APP-013, not enough to identify a purchase. |
| `food` | Money left in the week's food budget | `financial` | An amount only. Nothing about what was bought or where. |
| `travel` | Days until the next trip, **and the trip's name** | `personal` | The only card carrying free user content. "Bryllupsrejse til Paris" on a lock-screen-adjacent surface tells a bystander where you will be and when. It was already shown before this story; the change is that it is now classified, so APP-013 can mask it. **The strongest candidate for masking by default.** |
| `cycle` | Cycle day, days until next period | `health` | Special category data on a shared screen. No symptoms, no notes, no flow — those stay in the module. Even so, "Cycle day 12" identifies a menstrual cycle to anyone who glances at the phone. Already gated on the module being enabled; APP-013 must give it a masked mode, and APP-073 already governs the matching notification. |

Rules that came out of the review, enforced by test:

1. **A card may not carry a field outside the contract.** A test rejects extra
   keys — this is where a list of expenses or a symptom log would otherwise
   creep in.
2. **A card may not under-classify its module.** A card's `sensitivity` must be
   a class the module actually owns, so APP-013 can trust it when deciding what
   to mask.
3. **Values stay short** (≤ 24 characters), because a card is a summary. A long
   value is usually raw content that escaped.
4. **No card carries an identifier.** Routes are module roots (`/travel`), not
   `/travel/<id>`, so nothing on Home links straight to a specific record.

## Which modules provide a card

`economy`, `food`, `travel`, `cycle` — the four that Home already surfaced.

The other eight deliberately have none yet. Adding a card is two lines, but
*what Home should show* is a design decision about Home, not a side effect of
introducing a contract: ranking is APP-012, hiding and masking is APP-013, and
the module launcher is APP-015. Ten cards with no ranking would be worse than
four.

## What Home still reads directly

Four of the ten baselined couplings are gone. Six remain, and they are not
snapshots:

- **"Needs your attention"** — overdue to-dos, warranties expiring, household
  tasks. These are urgency signals, which is what `priority` is for; folding
  them in is APP-012's ranking work.
- **Rows you can tap** — ticking a to-do, logging a habit, accepting a trip
  invitation. These are *actions*, and the contract deliberately has none. A
  module exposing commands to Home is a separate design question that
  specification §4.2 answers with domain events.

Both are recorded in the APP-003 baseline with the story that removes them.
