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

## §4 Order (APP-012)

`rankHomeSnapshots` decides where each card sits. Three signals, in order:

1. **Pinned**, in the user's own order — their choice outranks urgency.
2. **Urgent**, then important, then normal — taken from the snapshot's
   `priority`, which comes from data.
3. **Recently used**, recorded from the routes the user visits rather than from
   card taps, so the order does not reinforce itself.

Registry order breaks any remaining tie, so the sort is a **total order**: the
same input always gives the same output. There is no engagement score, no
randomisation and no decay curve — see [ADR-0011](./adr/0011-home-ranking-is-deterministic.md).

**Hide and restore.** Long-press a card to pin or hide it; screen-reader users
get the same two options as accessibility actions, since a long press is not
discoverable. Hidden cards are listed at the bottom of Home and come back with
one tap — without a way back, "hide" reads as "delete".

Pinning and hiding are device-local and are not synced.

## §5 Privacy on a screen someone else can see (APP-013)

Home is the screen you hold up, hand over or leave on a table. Every card can
therefore be shown at one of three levels:

| Level | What is shown |
| --- | --- |
| `full` | Title, value, helper |
| `masked` | Title and `•••`; the value and helper are replaced |
| `hidden` | Not on Home at all (APP-012) |

Masking keeps the **title**. A card with no heading is not private, only
confusing — and the user still needs to know the card is there.

### Defaults

| Sensitivity | Default | Why |
| --- | --- | --- |
| `health` | **masked** | One glance at "Cycle day 12" reveals something the user never chose to say. Specification §8.7 asks for the same posture on Home widgets. |
| `financial`, `personal`, `document` | full | An amount on your own phone is a different kind of fact, and masking everything would make Home useless — at which point the user turns masking off and is left with nothing. |
| `ordinary` | full, not maskable | A shopping list has no secrets. |

The default is a protection, not a lock: health can be unmasked, and anything
maskable can be masked, per module, from the card's own long-press menu.

**Open question for review:** the travel card's helper is a raw trip name, the
most identifying thing on Home. It stays visible by default because it always
was, but it is the strongest candidate for changing that — a one-line change in
`defaultDetail` now that the mechanism exists.

### No sensitive flash while loading

Before the user's choices are read from disk, we do not know what they picked.
Guessing "full" would show the cycle day for a frame, exactly while the phone is
being handed to someone.

So a maskable card is **withheld entirely** until preferences have hydrated —
not merely masked, because a masked card would still reveal that the user has
the module at all, and that may be precisely what they hid. Ordinary cards
render immediately, so Home is not blank while the disk is read.

Sensitivity belongs to what a card **shows**, not to the module's name: an empty
travel card says "plan your first trip" and is classified `ordinary`, so it is
not masked for appearance's sake.

## §6 Loading and empty states (APP-014)

The distinction that matters is between **"we don't know yet"** and **"there is
nothing"**. Saying the second while the first is true is the worst message an
app can give by accident: it reads as lost data.

`resolveHomeGridState` decides, as a pure function, so slow storage
(`preferencesHydrated: false`) and a slow session (`isLoading: true`) can be
tested without a device.

| State | Shown |
| --- | --- |
| `loading` | Skeleton cards, same height as real ones so nothing jumps |
| `ready` | The cards |
| `empty-hidden` | "You have hidden every card" — your data is still here |
| `empty-no-modules` | "No modules turned on" — with where to turn them on |
| `empty-no-cards` | "Nothing to show yet" |

An empty state always says **why** and what to do about it, and names the thing
the user can fix first: if they have hidden cards, that is the answer, not "turn
on modules".

### Cards never present an unloaded store as fact

The providers read persisted stores. Zustand rehydrates asynchronously, so a
provider that ran immediately would compute from an *empty* store and render
**"0 kr." as a fact** to someone with thousands saved. That is worse than a
spinner: it looks like lost data, and nothing on screen suggests the number is
wrong.

Each provider therefore awaits its own stores via `whenStoresHydrated`, using
zustand's own persist API rather than adding a flag to every store. Home stays
in `loading` until the cards come back.

### Last known values survive a refresh

`useHomeSnapshots` never clears what it has before new results arrive, so
pull-to-refresh leaves the current cards in place rather than flashing empty.

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
