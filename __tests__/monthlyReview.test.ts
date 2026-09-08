import { isInMonth, previousMonthKey } from '@/core/modules/monthlyReview';
import { MONTHLY_REVIEW_PROVIDERS } from '@/features/monthlyReview';
import { useExpensesStore } from '@/store/useExpensesStore';
import { useFoodStore } from '@/store/useFoodStore';
import { useHabitsStore } from '@/store/useHabitsStore';
import { useIncomeStore } from '@/store/useIncomeStore';
import { useSavingsGoalsStore } from '@/store/useSavingsGoalsStore';
import { useTodoStore } from '@/store/useTodoStore';

/**
 * APP-016 — tilbageblikket må kun sige det, posterne siger.
 */

const MONTH = '2026-08';

const expense = (id: string, amount: number, date: string) => ({
  id,
  seriesId: id,
  isRecurring: false,
  name: `Post ${id}`,
  amount,
  category: 'other',
  nextPaymentDate: date,
  attachments: [],
  createdAt: `${date}T00:00:00.000Z`,
});

beforeEach(() => {
  useExpensesStore.setState({ expenses: [] });
  useIncomeStore.setState({ incomeByMonth: {} });
  useSavingsGoalsStore.setState({ goals: [], history: [] });
  useTodoStore.setState({ todos: [] });
  useHabitsStore.setState({ habits: [] });
  useFoodStore.setState({ purchases: [], monthlyBudgetByMonth: {} });
});

describe('kun udledte kendsgerninger', () => {
  it('summerer præcis de poster, måneden indeholder', async () => {
    useExpensesStore.setState({
      expenses: [
        expense('a', 100, '2026-08-03'),
        expense('b', 250, '2026-08-28'),
        // Naboer i kalenderen, men ikke i måneden.
        expense('c', 999, '2026-07-31'),
        expense('d', 999, '2026-09-01'),
      ],
    });

    const facts = await MONTHLY_REVIEW_PROVIDERS.economy!(MONTH);
    const spent = facts.find((fact) => fact.labelKey === 'review.economySpent');
    expect(spent?.params).toEqual({ amount: '350', count: 2 });
  });

  it('siger ingenting, når der ingen poster er — frem for at vise nul', async () => {
    // En side fuld af nuller er ikke information, og "0 klaret" er en
    // bebrejdelse forklædt som et tal.
    for (const moduleId of Object.keys(MONTHLY_REVIEW_PROVIDERS) as (keyof typeof MONTHLY_REVIEW_PROVIDERS)[]) {
      expect(await MONTHLY_REVIEW_PROVIDERS[moduleId]!(MONTH)).toEqual([]);
    }
  });

  it('sammenligner kun, når begge tal findes', async () => {
    // Uden et budget nævnes budgettet ikke. "Over budget" uden et budget ville
    // være opfundet.
    useFoodStore.setState({
      purchases: [{ id: 'p1', amount: 400, date: '2026-08-10' }],
      monthlyBudgetByMonth: {},
    });
    let facts = await MONTHLY_REVIEW_PROVIDERS.food!(MONTH);
    expect(facts.map((fact) => fact.labelKey)).toEqual(['review.foodSpent']);

    useFoodStore.setState({ monthlyBudgetByMonth: { [MONTH]: 3000 } });
    facts = await MONTHLY_REVIEW_PROVIDERS.food!(MONTH);
    expect(facts.map((fact) => fact.labelKey)).toEqual(['review.foodSpent', 'review.foodBudget']);
  });

  it('behandler en udbetaling som en oplysning, ikke et nederlag', async () => {
    useSavingsGoalsStore.setState({
      history: [{ id: 'h1', goalId: 'g1', amount: -500, date: '2026-08-12' }],
    });
    const facts = await MONTHLY_REVIEW_PROVIDERS.economy!(MONTH);
    expect(facts[0].labelKey).toBe('review.economyWithdrawn');
    expect(facts[0].params).toEqual({ amount: '500' });
  });

  it('tæller ikke det, der IKKE blev gjort', async () => {
    // Antallet af uafsluttede gøremål ville kun være en løftet pegefinger.
    useTodoStore.setState({
      todos: [
        { id: '1', title: 'a', importance: 'low', completed: true, createdAt: '2026-08-02T00:00:00.000Z' },
        { id: '2', title: 'b', importance: 'low', completed: false, createdAt: '2026-08-03T00:00:00.000Z' },
      ],
    });
    const facts = await MONTHLY_REVIEW_PROVIDERS.tasks!(MONTH);
    expect(facts.map((fact) => fact.labelKey)).toEqual(['review.tasksCreated', 'review.tasksCompleted']);
    expect(facts.find((f) => f.labelKey === 'review.tasksCompleted')?.params).toEqual({ count: 1 });
    expect(JSON.stringify(facts)).not.toContain('remaining');
  });
});

describe('determinisme', () => {
  it('giver samme svar, hver gang det spørges', async () => {
    useExpensesStore.setState({ expenses: [expense('a', 120, '2026-08-05')] });
    const first = await MONTHLY_REVIEW_PROVIDERS.economy!(MONTH);
    for (let i = 0; i < 5; i++) {
      expect(await MONTHLY_REVIEW_PROVIDERS.economy!(MONTH)).toEqual(first);
    }
  });

  it('leverer nøgler og tal, ikke færdige sætninger', async () => {
    // Så en model senere kan formulere dem — men aldrig producere dem.
    useHabitsStore.setState({
      habits: [{ id: 'h', title: 'Løb', direction: 'build', logs: [{ id: 'l', date: '2026-08-04' }], createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const facts = await MONTHLY_REVIEW_PROVIDERS.habits!(MONTH);
    expect(facts[0].labelKey).toMatch(/^review\./);
    expect(facts[0]).not.toHaveProperty('text');
    expect(facts[0].params).toEqual({ count: 1, habits: 1 });
  });
});

describe('månedsgrænser', () => {
  it('bruger kalendermåneden, ikke en tidszone', () => {
    expect(isInMonth('2026-08-01', '2026-08')).toBe(true);
    expect(isInMonth('2026-08-31', '2026-08')).toBe(true);
    expect(isInMonth('2026-07-31', '2026-08')).toBe(false);
    expect(isInMonth('2026-09-01', '2026-08')).toBe(false);
  });

  it('finder måneden før, også hen over et årsskifte', () => {
    expect(previousMonthKey(new Date(2026, 8, 7))).toBe('2026-08');
    expect(previousMonthKey(new Date(2026, 0, 15))).toBe('2025-12');
    // 1. marts: februar, uanset hvor mange dage den havde.
    expect(previousMonthKey(new Date(2024, 2, 1))).toBe('2024-02');
  });

  it('lader sig ikke forvirre af sommertid', () => {
    // Testene kører i Europe/Copenhagen; skiftet ligger sidste søndag i oktober.
    expect(previousMonthKey(new Date(2026, 9, 25))).toBe('2026-09');
    expect(previousMonthKey(new Date(2026, 10, 1))).toBe('2026-10');
  });
});
