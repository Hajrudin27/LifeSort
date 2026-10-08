import {
  buildGoal,
  decodeGoal,
  decodeGoals,
  decodeLegacyGoal,
  decodeMilestones,
  decodeRemoteGoalRow,
  GOAL_TYPES,
  GoalError,
  goalIsCompleted,
  goalMilestoneSummary,
  goalProgress,
  goalToRow,
  MAX_GOAL_VALUE,
  meanGoalProgress,
  updateGoalFields,
  withCompleted,
  withCurrent,
  withMilestone,
  withMilestoneToggled,
  withoutMilestone,
  type NewGoalInput,
} from '@/features/goals/domain/goal';
import {
  EMPTY_VALUE_TEXT,
  hundredthsToText,
  minutesToParts,
  parseAmountInput,
  parseCountInput,
  parseDurationInput,
  validateGoalForm,
  valueTextFrom,
  type GoalFormState,
} from '@/features/goals/domain/goalInput';
import type { LifeGoal } from '@/types/life';

const base = { id: 'g1', title: 'Goal', milestones: [], createdAt: '2026-10-01T10:00:00.000Z' };
const binary = (completed = false): LifeGoal => ({ ...base, type: 'binary', completed });
const count = (current: number, target: number): LifeGoal => ({ ...base, type: 'count', current, target });
const amount = (current: number, target: number): LifeGoal => ({ ...base, type: 'amount', current, target, unit: 'km' });
const duration = (current: number, target: number): LifeGoal => ({ ...base, type: 'duration', current, target });
const fails = (action: () => unknown, code: string) => {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(GoalError); expect((error as GoalError).code).toBe(code); return; }
  throw new Error(`expected GoalError ${code}`);
};

describe('APP-063 canonical shapes', () => {
  it('has exactly the four approved types', () => expect([...GOAL_TYPES]).toEqual(['binary', 'count', 'amount', 'duration']));

  it.each([binary(), binary(true), count(0, 12), count(7, 12), amount(2550, 10_000), duration(90, 6_000)])(
    'accepts a valid %j and returns a fresh equal object', (goal) => {
      const decoded = decodeGoal(goal);
      expect(decoded).toEqual(goal);
      expect(decoded).not.toBe(goal);
    });

  it.each([
    ['an unknown type', { ...binary(), type: 'habit' }],
    ['a missing type', (({ type, ...rest }) => rest)(binary() as LifeGoal & { type: string })],
    ['a binary goal carrying a target', { ...binary(), target: 3 }],
    ['a binary goal carrying a current value', { ...binary(), current: 0 }],
    ['a binary goal carrying a unit', { ...binary(), unit: 'km' }],
    ['a binary goal without completed', (({ completed, ...rest }) => rest)(binary() as LifeGoal & { completed: boolean })],
    ['a non-boolean completed', { ...binary(), completed: 'yes' }],
    ['a count goal carrying completed', { ...count(1, 2), completed: false }],
    ['a count goal carrying a unit', { ...count(1, 2), unit: 'km' }],
    ['an amount goal without a unit', (({ unit, ...rest }) => rest)(amount(1, 2) as LifeGoal & { unit: string })],
    ['an amount goal carrying completed', { ...amount(1, 2), completed: true }],
    ['a duration goal carrying a unit', { ...duration(1, 2), unit: 'min' }],
    ['a count goal missing current', (({ current, ...rest }) => rest)(count(1, 2) as LifeGoal & { current: number })],
    ['a target of zero', count(0, 0)],
    ['a negative target', count(0, -1)],
    ['a negative current', count(-1, 5)],
    ['a fractional current', count(1.5, 5)],
    ['a fractional target', count(1, 2.5)],
    ['NaN', count(Number.NaN, 5)],
    ['Infinity', count(Infinity, 5)],
    ['a string number', { ...count(1, 5), current: '1' }],
    ['an unsafe integer', count(Number.MAX_SAFE_INTEGER + 1, 5)],
    ['a value above the bound', count(MAX_GOAL_VALUE + 1, 5)],
    ['a target above the bound', count(1, MAX_GOAL_VALUE + 1)],
    ['an empty id', { ...binary(), id: '' }],
    ['a blank title', { ...binary(), title: '   ' }],
    ['an unparseable createdAt', { ...binary(), createdAt: 'yesterday' }],
    ['an impossible deadline', { ...binary(), deadline: '2026-02-30' }],
    ['a non-string description', { ...binary(), description: 3 }],
    ['an unknown field', { ...binary(), address: 'Main St 1' }],
    ['a blank unit', amount(1, 2) && { ...amount(1, 2), unit: '  ' }],
    ['an untrimmed unit', { ...amount(1, 2), unit: ' km' }],
    ['a 25-character unit', { ...amount(1, 2), unit: 'x'.repeat(25) }],
  ])('rejects %s', (_label, value) => expect(decodeGoal(value)).toBeNull());

  it('accepts the bounds exactly: 1 and the maximum, a 24-character unit', () => {
    expect(decodeGoal(count(0, 1))).not.toBeNull();
    expect(decodeGoal(count(MAX_GOAL_VALUE, MAX_GOAL_VALUE))).not.toBeNull();
    expect(decodeGoal({ ...amount(1, 1), unit: 'x'.repeat(24) })).not.toBeNull();
  });

  it('rejects duplicate goal ids in a list but accepts an empty list', () => {
    expect(decodeGoals([binary(), binary()])).toBeNull();
    expect(decodeGoals([])).toEqual([]);
    expect(decodeGoals('x')).toBeNull();
  });

  it('introduces no currency: no currency field, no money primitive in the domain', () => {
    const row = goalToRow('u', amount(1250, 10_000));
    expect(Object.keys(row).filter((key) => /currency|minor|money|price/i.test(key))).toEqual([]);
    expect(row.unit).toBe('km');
  });
});

describe('APP-063 progress and completion', () => {
  it.each([
    ['binary open', binary(false), 0, false],
    ['binary done', binary(true), 1, true],
    ['count below', count(7, 12), 7 / 12, false],
    ['count at target', count(12, 12), 1, true],
    ['count above target clamps the ratio', count(30, 12), 1, true],
    ['count zero progress', count(0, 12), 0, false],
    ['amount below', amount(2550, 10_000), 0.255, false],
    ['amount above', amount(20_000, 10_000), 1, true],
    ['duration below', duration(30, 120), 0.25, false],
    ['duration at target', duration(120, 120), 1, true],
  ])('%s', (_label, goal, progress, completed) => {
    expect(goalProgress(goal)).toBeCloseTo(progress as number, 12);
    expect(goalIsCompleted(goal)).toBe(completed);
  });

  it('never divides by zero even for a state validation would refuse', () => {
    const impossible = { ...count(5, 0) } as LifeGoal;
    expect(goalProgress(impossible)).toBe(0);
    expect(goalIsCompleted(impossible)).toBe(false);
  });

  it('milestones never change progress or completion, for any type', () => {
    const steps = [{ id: 'a', title: 'A', completed: true }, { id: 'b', title: 'B', completed: true }];
    for (const goal of [binary(false), count(1, 5), amount(1, 5), duration(1, 5)]) {
      const withSteps = { ...goal, milestones: steps } as LifeGoal;
      expect(goalProgress(withSteps)).toBe(goalProgress(goal));
      expect(goalIsCompleted(withSteps)).toBe(goalIsCompleted(goal));
    }
    // Completing every milestone does not complete a binary goal.
    expect(goalIsCompleted({ ...binary(false), milestones: steps })).toBe(false);
  });

  it('summarizes milestones separately', () => {
    expect(goalMilestoneSummary({ milestones: [{ id: 'a', title: 'A', completed: true }, { id: 'b', title: 'B', completed: false }] }))
      .toEqual({ done: 1, total: 2 });
  });

  it('the dashboard mean is the mean of each goal\'s own progress, 0 with none', () => {
    expect(meanGoalProgress([])).toBe(0);
    expect(meanGoalProgress([binary(true), count(6, 12), count(0, 10)])).toBeCloseTo((1 + 0.5 + 0) / 3, 12);
    expect(meanGoalProgress([count(50, 10)])).toBe(1);
  });
});

describe('APP-063 building and changing goals', () => {
  const at = '2026-10-07T10:00:00.000Z';

  it('builds each type from validated input; binary starts open, numeric starts at 0 by default', () => {
    expect(buildGoal({ title: ' Licence ', type: 'binary' }, 'x', at)).toEqual({ id: 'x', title: 'Licence', milestones: [], createdAt: at, type: 'binary', completed: false });
    expect(buildGoal({ title: 'Books', type: 'count', target: 12 }, 'x', at)).toMatchObject({ type: 'count', target: 12, current: 0 });
    expect(buildGoal({ title: 'Run', type: 'amount', target: 10_000, current: 250, unit: ' km ' }, 'x', at)).toMatchObject({ unit: 'km', current: 250 });
    expect(buildGoal({ title: 'Study', type: 'duration', target: 6000 }, 'x', at)).toMatchObject({ type: 'duration', target: 6000, current: 0 });
  });

  it('keeps a deadline exactly and drops a blank description', () => {
    expect(buildGoal({ title: 'T', type: 'binary', deadline: '2026-10-07', description: '   ' }, 'x', at))
      .toEqual({ id: 'x', title: 'T', deadline: '2026-10-07', milestones: [], createdAt: at, type: 'binary', completed: false });
  });

  it.each([
    ['a blank title', { title: ' ', type: 'binary' }, 'goal_title_invalid'],
    ['an unknown type', { title: 'T', type: 'habit' }, 'goal_type_invalid'],
    ['a bad deadline', { title: 'T', type: 'binary', deadline: '2026-13-01' }, 'goal_deadline_invalid'],
    ['a zero target', { title: 'T', type: 'count', target: 0 }, 'goal_target_invalid'],
    ['a fractional target', { title: 'T', type: 'count', target: 1.5 }, 'goal_target_invalid'],
    ['a negative current', { title: 'T', type: 'count', target: 3, current: -1 }, 'goal_current_invalid'],
    ['a missing unit', { title: 'T', type: 'amount', target: 3, unit: ' ' }, 'goal_unit_invalid'],
    ['a long unit', { title: 'T', type: 'amount', target: 3, unit: 'y'.repeat(25) }, 'goal_unit_invalid'],
    ['a unit on a count goal', { title: 'T', type: 'count', target: 3, unit: 'km' }, 'goal_field_invalid'],
    ['a target on a binary goal', { title: 'T', type: 'binary', target: 3 }, 'goal_field_invalid'],
  ])('refuses %s with one fixed code', (_label, input, code) => {
    fails(() => buildGoal(input as unknown as NewGoalInput, 'x', at), code);
  });

  it('the type is immutable and type-foreign fields are refused', () => {
    fails(() => updateGoalFields(binary(), { target: 5 }), 'goal_field_invalid');
    fails(() => updateGoalFields(count(1, 5), { unit: 'km' }), 'goal_field_invalid');
    fails(() => updateGoalFields(count(1, 5), { target: 0 }), 'goal_target_invalid');
    expect(updateGoalFields(count(1, 5), { target: 1 })).toMatchObject({ type: 'count', target: 1 });
  });

  it('editing the target below current simply makes the goal completed (completion is derived)', () => {
    const edited = updateGoalFields(count(7, 12), { target: 5 });
    expect(goalIsCompleted(edited)).toBe(true);
    expect(goalIsCompleted(updateGoalFields(edited, { target: 20 }))).toBe(false);
  });

  it('deadline can be set to today, the past, or cleared; it never changes completion', () => {
    const goal = count(1, 5);
    for (const deadline of ['2026-10-07', '2019-01-01', '2030-12-31']) {
      const next = updateGoalFields(goal, { deadline });
      expect(next.deadline).toBe(deadline);
      expect(goalIsCompleted(next)).toBe(false);
    }
    expect('deadline' in updateGoalFields({ ...goal, deadline: '2026-10-07' }, { deadline: null })).toBe(false);
    fails(() => updateGoalFields(goal, { deadline: '2026-02-29' }), 'goal_deadline_invalid');
  });

  it('title and description updates trim; a blank title is refused and a blank description clears', () => {
    expect(updateGoalFields({ ...binary(), description: 'x' }, { title: '  New ', description: '  ' })).toEqual({ ...binary(), title: 'New' });
    fails(() => updateGoalFields(binary(), { title: ' ' }), 'goal_title_invalid');
  });

  it('setCurrent is absolute and idempotent; binary uses completed/reopen; mixing them is refused', () => {
    const once = withCurrent(count(0, 12), 7);
    expect(withCurrent(once, 7)).toEqual(once);
    expect(withCurrent(once, 99)).toMatchObject({ current: 99 });
    fails(() => withCurrent(once, -1), 'goal_current_invalid');
    fails(() => withCurrent(once, 2.5), 'goal_current_invalid');
    fails(() => withCurrent(once, MAX_GOAL_VALUE + 1), 'goal_current_invalid');
    fails(() => withCurrent(binary(), 1), 'goal_type_mismatch');
    expect(withCompleted(withCompleted(binary(), true), false)).toEqual(binary(false));
    fails(() => withCompleted(count(1, 2), true), 'goal_type_mismatch');
  });
});

describe('APP-063 milestones', () => {
  const step = (id: string, completed = false) => ({ id, title: id, completed });

  it('add, toggle and remove touch only the milestone list', () => {
    let goal: LifeGoal = count(3, 10);
    goal = withMilestone(goal, step('a'));
    goal = withMilestone(goal, step('b'));
    goal = withMilestoneToggled(goal, 'a');
    expect(goal.milestones).toEqual([step('a', true), step('b')]);
    expect(goalProgress(goal)).toBeCloseTo(0.3, 12);
    goal = withoutMilestone(goal, 'a');
    expect(goal.milestones).toEqual([step('b')]);
    expect(withMilestoneToggled(goal, 'missing')).toEqual(goal);
  });

  it('refuses a duplicate id, a blank title and a malformed milestone', () => {
    const goal = withMilestone(binary(), step('a'));
    fails(() => withMilestone(goal, step('a')), 'goal_milestone_invalid');
    fails(() => withMilestone(goal, { id: 'c', title: ' ', completed: false }), 'goal_milestone_invalid');
    expect(decodeMilestones([step('a'), step('a')])).toBeNull();
    expect(decodeMilestones([{ id: 'a', title: 'A' }])).toBeNull();
    expect(decodeMilestones([{ ...step('a'), extra: 1 }])).toBeNull();
  });

  it('a large historical list is valid: there is no count limit', () => {
    const many = Array.from({ length: 500 }, (_, index) => step(`m${index}`, index % 2 === 0));
    expect(decodeMilestones(many)).toHaveLength(500);
    expect(decodeGoal({ ...binary(), milestones: many })).not.toBeNull();
  });
});

describe('APP-063 legacy goals', () => {
  const legacy = (subGoals: unknown, extra: Record<string, unknown> = {}) => ({
    id: 'old', title: 'Old', subGoals, createdAt: '2026-09-01T10:00:00.000Z', ...extra,
  });
  const sub = (id: string, completed: boolean) => ({ id, title: `T${id}`, completed });

  it('no sub-goals: binary, not completed', () => {
    expect(decodeLegacyGoal(legacy([]))).toEqual({ ...base, id: 'old', title: 'Old', createdAt: '2026-09-01T10:00:00.000Z', type: 'binary', completed: false });
  });
  it('partly done: binary, not completed, every milestone preserved verbatim, no numbers invented', () => {
    const goal = decodeLegacyGoal(legacy([sub('1', true), sub('2', false)]))!;
    expect(goal.type).toBe('binary');
    expect(goal).toMatchObject({ completed: false, milestones: [sub('1', true), sub('2', false)] });
    expect('target' in goal || 'current' in goal || 'unit' in goal).toBe(false);
  });
  it('all done with at least one: binary, completed', () => {
    expect(decodeLegacyGoal(legacy([sub('1', true), sub('2', true)]))).toMatchObject({ type: 'binary', completed: true });
    expect(decodeLegacyGoal(legacy([sub('1', true)]))).toMatchObject({ completed: true });
  });
  it('keeps description and deadline exactly', () => {
    expect(decodeLegacyGoal(legacy([], { description: 'D', deadline: '2020-02-29' }))).toMatchObject({ description: 'D', deadline: '2020-02-29' });
  });
  it('a historically completed goal stays completed when a milestone is added later', () => {
    const done = decodeLegacyGoal(legacy([sub('1', true)]))!;
    const grown = withMilestone(done, sub('2', false));
    expect(goalIsCompleted(grown)).toBe(true);
  });
  it.each([
    ['a non-array subGoals', legacy('x')],
    ['a milestone without a title', legacy([{ id: 'a', completed: true }])],
    ['duplicate milestone ids', legacy([sub('1', true), sub('1', false)])],
    ['an unknown field', legacy([], { type: 'binary' })],
    ['a canonical goal', { ...binary() }],
    ['a bad deadline', legacy([], { deadline: 'soon' })],
    ['a missing createdAt', { id: 'x', title: 'x', subGoals: [] }],
  ])('rejects %s', (_label, value) => expect(decodeLegacyGoal(value)).toBeNull());
});

describe('APP-063 server rows', () => {
  const row = (extra: Record<string, unknown> = {}) => ({
    id: 'r1', title: 'Row', description: null, deadline: null, sub_goals: [], created_at: '2026-10-01T10:00:00+00:00',
    goal_type: null, target_value: null, current_value: null, unit: null, completed: null, ...extra,
  });

  it('every typed column NULL is a legacy goal, read through the same mapping, never an error', () => {
    expect(decodeRemoteGoalRow(row())).toMatchObject({ type: 'binary', completed: false });
    expect(decodeRemoteGoalRow(row({ sub_goals: [{ id: 'a', title: 'A', completed: true }] }))).toMatchObject({ type: 'binary', completed: true });
    expect(decodeRemoteGoalRow(row({ sub_goals: undefined }))).toMatchObject({ type: 'binary', milestones: [] });
  });

  it.each([
    ['binary', { goal_type: 'binary', completed: true }, { type: 'binary', completed: true }],
    ['count', { goal_type: 'count', target_value: 12, current_value: 7 }, { type: 'count', target: 12, current: 7 }],
    ['amount', { goal_type: 'amount', target_value: 10_000, current_value: 250, unit: 'km' }, { type: 'amount', unit: 'km', current: 250 }],
    ['duration', { goal_type: 'duration', target_value: '6000', current_value: '90' }, { type: 'duration', target: 6000, current: 90 }],
  ])('reads a typed %s row', (_label, columns, expected) => {
    expect(decodeRemoteGoalRow(row(columns))).toMatchObject(expected);
  });

  it.each([
    ['an unknown type', { goal_type: 'habit', completed: true }],
    ['a binary row with a target', { goal_type: 'binary', completed: true, target_value: 1 }],
    ['a count row with completed', { goal_type: 'count', target_value: 1, current_value: 0, completed: true }],
    ['a count row with a unit', { goal_type: 'count', target_value: 1, current_value: 0, unit: 'km' }],
    ['a typed value without its type', { target_value: 1 }],
    ['an out-of-bound value', { goal_type: 'count', target_value: MAX_GOAL_VALUE + 1, current_value: 0 }],
    ['a zero target', { goal_type: 'count', target_value: 0, current_value: 0 }],
    ['an amount without a unit', { goal_type: 'amount', target_value: 1, current_value: 0 }],
    ['malformed milestones', { sub_goals: [{ id: 'a' }] }],
    ['non-array milestones', { sub_goals: { a: 1 } }],
    ['an unparseable value', { goal_type: 'count', target_value: 'lots', current_value: 0 }],
  ])('drops %s instead of guessing or crashing', (_label, extra) => expect(decodeRemoteGoalRow(row(extra))).toBeNull());

  it('a non-object row is dropped', () => {
    for (const bad of [null, undefined, 'x', 3, []]) expect(decodeRemoteGoalRow(bad)).toBeNull();
  });

  it('writes the typed columns exactly, with milestones in the historical column', () => {
    const goal = { ...amount(1250, 10_000), milestones: [{ id: 'a', title: 'A', completed: true }], description: 'D', deadline: '2026-12-01' } as LifeGoal;
    expect(goalToRow('u1', goal)).toEqual({
      id: 'g1', user_id: 'u1', title: 'Goal', description: 'D', deadline: '2026-12-01',
      sub_goals: [{ id: 'a', title: 'A', completed: true }], created_at: base.createdAt,
      goal_type: 'amount', target_value: 10_000, current_value: 1250, unit: 'km', completed: null,
    });
    expect(goalToRow('u1', binary(true))).toMatchObject({ goal_type: 'binary', completed: true, target_value: null, current_value: null, unit: null });
    expect(goalToRow('u1', count(2, 3))).toMatchObject({ goal_type: 'count', completed: null, unit: null });
  });

  it('round-trips every type through a row', () => {
    for (const goal of [binary(true), count(7, 12), amount(2550, 10_000), duration(90, 6000)]) {
      const written = goalToRow('u', goal);
      expect(decodeRemoteGoalRow({ ...written, created_at: goal.createdAt })).toEqual(goal);
    }
  });
});

describe('APP-063 input parsing (exact, no floating point)', () => {
  it.each([['12', 12], [' 7 ', 7], ['0', 0], ['007', 7], ['1000000000000', MAX_GOAL_VALUE]])('count %j', (text, value) => {
    expect(parseCountInput(text)).toEqual({ ok: true, value });
  });
  it.each([['-1'], ['1.5'], ['1,5'], ['1e3'], [''], ['abc'], ['１２'], ['1 000']])('count rejects %j', (text) => {
    expect(parseCountInput(text)).toMatchObject({ ok: false });
  });
  it('count refuses what exceeds the bound', () => expect(parseCountInput('1000000000001')).toEqual({ ok: false, code: 'input_too_large' }));

  it.each([['12', 1200], ['12,5', 1250], ['12.50', 1250], ['0.01', 1], ['0,1', 10], ['100', 10_000], ['19.99', 1999], ['0.07', 7]])(
    'amount %j is %i hundredths', (text, value) => expect(parseAmountInput(text)).toEqual({ ok: true, value }));
  it.each([['1.234'], ['1,2,3'], ['1.2,3'], ['-1'], ['.5'], ['5.'], ['1e2'], ['kr 5'], ['']])('amount rejects %j', (text) => {
    expect(parseAmountInput(text)).toMatchObject({ ok: false });
  });
  it('amount stays exact where a float would not: 0.1 + 0.2 style inputs', () => {
    // 1.15 * 100 is 114.99999999999999 in floating point; the digit-string parser is exact.
    expect(1.15 * 100).not.toBe(115);
    expect(parseAmountInput('1.15')).toEqual({ ok: true, value: 115 });
    expect(parseAmountInput('4.35')).toEqual({ ok: true, value: 435 });
    expect(parseAmountInput('10000000000')).toEqual({ ok: true, value: 1_000_000_000_000 });
    expect(parseAmountInput('10000000001')).toEqual({ ok: false, code: 'input_too_large' });
  });

  it.each([
    ['0.01', 1], ['0.10', 10], ['1.00', 100], ['12.34', 1234], ['12,34', 1234], ['007.50', 750], ['0', 0], ['00.5', 50],
    [' 12.34 ', 1234], ['\t12,34\n', 1234], ['10000000000.00', MAX_GOAL_VALUE], ['9999999999.99', 999_999_999_999],
  ])('amount %j is exactly %i hundredths', (text, value) => expect(parseAmountInput(text)).toEqual({ ok: true, value }));
  it.each([['1 2.34'], ['12.3.4'], ['+5'], ['--5'], ['١٢'], ['１２'], ['1_000'], ['0x10'], ['12.'], ['NaN'], ['Infinity'], ['1E3'], ['1e-2']])(
    'amount rejects %j without throwing', (text) => expect(parseAmountInput(text)).toEqual({ ok: false, code: 'input_invalid' }));
  it('amount refuses anything beyond the bound, including absurdly long input, before any numeric conversion', () => {
    expect(parseAmountInput('10000000000.01')).toEqual({ ok: false, code: 'input_too_large' });
    expect(parseAmountInput('9'.repeat(400))).toEqual({ ok: false, code: 'input_too_large' });
    expect(parseAmountInput(`${'9'.repeat(400)}.99`)).toEqual({ ok: false, code: 'input_too_large' });
    expect(parseAmountInput('0'.repeat(400) + '5.5')).toEqual({ ok: true, value: 550 });
  });

  it('duration is canonical minutes', () => {
    expect(parseDurationInput('1', '30')).toEqual({ ok: true, value: 90 });
    expect(parseDurationInput('', '45')).toEqual({ ok: true, value: 45 });
    expect(parseDurationInput('100', '')).toEqual({ ok: true, value: 6000 });
    expect(parseDurationInput('', '')).toEqual({ ok: true, value: 0 });
    expect(parseDurationInput('0', '60')).toMatchObject({ ok: false });
    expect(parseDurationInput('1.5', '0')).toMatchObject({ ok: false });
    expect(parseDurationInput('-1', '0')).toMatchObject({ ok: false });
    expect(parseDurationInput('99999999999', '0')).toMatchObject({ ok: false });
    expect(minutesToParts(6030)).toEqual({ hours: 100, minutes: 30 });
  });

  it('formats exactly and re-parses to the same value', () => {
    for (const value of [1, 10, 100, 1250, 1999, 10_000, 123_456]) {
      for (const separator of [',', '.'] as const) {
        expect(parseAmountInput(hundredthsToText(value, separator))).toEqual({ ok: true, value });
      }
    }
    expect(hundredthsToText(1250, ',')).toBe('12,5');
    expect(hundredthsToText(1200, '.')).toBe('12');
    expect(hundredthsToText(5, '.')).toBe('0.05');
    for (const [type, value] of [['count', 7], ['amount', 2550], ['duration', 6030]] as const) {
      const text = valueTextFrom(type, value, ',');
      const parsed = type === 'count' ? parseCountInput(text.text) : type === 'amount' ? parseAmountInput(text.text) : parseDurationInput(text.hours, text.minutes);
      expect(parsed).toEqual({ ok: true, value });
    }
  });
});

describe('APP-063 the goal form', () => {
  const form = (changes: Partial<GoalFormState>): GoalFormState => ({
    type: 'count', title: 'Books', description: '', deadline: null,
    target: { ...EMPTY_VALUE_TEXT, text: '12' }, current: EMPTY_VALUE_TEXT, unit: '', ...changes,
  });

  it('turns typed text into canonical input; a blank progress means 0', () => {
    expect(validateGoalForm(form({}))).toEqual({ ok: true, input: { title: 'Books', type: 'count', target: 12, current: 0 } });
    expect(validateGoalForm(form({ type: 'amount', unit: ' km ', target: { ...EMPTY_VALUE_TEXT, text: '100,5' }, current: { ...EMPTY_VALUE_TEXT, text: '2.25' } })))
      .toEqual({ ok: true, input: { title: 'Books', type: 'amount', target: 10_050, current: 225, unit: 'km' } });
    expect(validateGoalForm(form({ type: 'duration', target: { text: '', hours: '100', minutes: '' } })))
      .toEqual({ ok: true, input: { title: 'Books', type: 'duration', target: 6000, current: 0 } });
    expect(validateGoalForm(form({ type: 'binary', description: '  why ' }))).toEqual({ ok: true, input: { title: 'Books', type: 'binary', description: 'why' } });
  });

  it('keeps exactly the deadline the user sees', () => {
    expect(validateGoalForm(form({ type: 'binary', deadline: '2026-10-07' }))).toMatchObject({ ok: true, input: { deadline: '2026-10-07' } });
    expect(validateGoalForm(form({ type: 'binary', deadline: null }))).toEqual({ ok: true, input: { title: 'Books', type: 'binary' } });
  });

  it('reports every problem with a field-level key and sends nothing invalid onward', () => {
    expect(validateGoalForm(form({ title: ' ', target: EMPTY_VALUE_TEXT }))).toEqual({ ok: false, errors: { title: 'title', target: 'targetCount' } });
    expect(validateGoalForm(form({ target: { ...EMPTY_VALUE_TEXT, text: '0' } }))).toEqual({ ok: false, errors: { target: 'targetCount' } });
    expect(validateGoalForm(form({ type: 'amount', unit: '', target: { ...EMPTY_VALUE_TEXT, text: '5' } }))).toEqual({ ok: false, errors: { unit: 'unit' } });
    expect(validateGoalForm(form({ type: 'amount', unit: 'km', target: { ...EMPTY_VALUE_TEXT, text: '1.234' } }))).toEqual({ ok: false, errors: { target: 'targetAmount' } });
    expect(validateGoalForm(form({ current: { ...EMPTY_VALUE_TEXT, text: '-3' } }))).toEqual({ ok: false, errors: { current: 'currentCount' } });
    expect(validateGoalForm(form({ type: 'duration', target: { text: '', hours: '1', minutes: '75' } }))).toEqual({ ok: false, errors: { target: 'targetDuration' } });
    expect(validateGoalForm(form({ target: { ...EMPTY_VALUE_TEXT, text: '99999999999999' } }))).toEqual({ ok: false, errors: { target: 'tooLarge' } });
  });
});
