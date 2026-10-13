import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Text as SvgText } from 'react-native-svg';

import i18n from '@/localization/i18n';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: (props: object) => require('react').createElement(require('react-native').View, props),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useAccentTints', () => ({ useAccentTints: () => ({ accent: '#0057D9', accentSoft: '#CCDDF5' }) }));
jest.mock('@/hooks/useBrandTints', () => ({
  useBrandTints: () => ({ ink: '#000', glowPrimary: '#111', glowSecondary: '#222', accent: '#333', accentSoft: '#444' }),
}));
jest.mock('@/hooks/useTabBarScroll', () => ({ useTabBarScroll: () => undefined }));
jest.mock('@/utils/auth/pinAuth', () => ({ clearLocalPin: jest.fn() }));
jest.mock('@/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ session: null }) } }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
}));

import CycleScreen from '@/app/(tabs)/cycle';
import NewTodoScreen from '@/app/todos/new';
import Chip from '@/components/Chip';
import CycleMonthCalendar from '@/components/CycleMonthCalendar';
import CycleWheel from '@/components/CycleWheel';
import { cycleHomeSnapshot } from '@/features/cycle/homeSnapshot';
import { useCycleStore } from '@/store/useCycleStore';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { getPhaseForDate } from '@/utils/cycle/cycleInsights';

/**
 * APP-075 — what the user is actually shown. The sibling source/locale suite proves the copy
 * exists; this one renders the screens, so a safety line that is still in a locale file but no
 * longer reaches the screen (or an accessibility label that is not exposed) fails here.
 */

let tree: TestRenderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => { await act(async () => { tree = TestRenderer.create(element); }); };
const texts = () => tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const svgTexts = () => tree.root.findAllByType(SvgText).map((node) => [node.props.children].flat().join(''));
const accessibleGroups = () => tree.root.findAll(
  (node) => typeof node.type === 'string' && node.props.accessible === true && typeof node.props.accessibilityLabel === 'string',
);
/** Host element name (e.g. the native SVG view); `node.type` is typed as a component, not a string. */
const hostName = (node: TestRenderer.ReactTestInstance) => node.type as unknown as string;
const setNow = (year: number, month: number, day: number) => jest.useFakeTimers({
  now: new Date(year, month - 1, day, 12),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'performance', 'hrtime'],
});
const cycle = (id: string, startDate: string, endDate?: string) => ({ id, startDate, endDate }) as any;

const setCycles = (cycles: unknown[]) => useCycleStore.setState({
  cycles: cycles as any, symptomLogs: [], avgCycleLength: 28, lutealPhaseLength: 14,
});
const setSymptomLogs = (symptomLogs: unknown[]) => useCycleStore.setState({ symptomLogs: symptomLogs as any });

// Today is 2026-10-13 (Tuesday).
const OPEN_PERIOD = [cycle('a', '2026-10-11')]; // day 3 of a logged, still-open period
const COMPLETED_PERIOD = [cycle('a', '2026-10-01', '2026-10-05')]; // day 13; the model infers the fertile window from here
const STALE_PERIOD = [cycle('a', '2026-09-01', '2026-09-05')]; // predicted 2026-09-29: already passed on the frozen date
// Predicted 2026-10-12, passed yesterday. Unlike STALE_PERIOD its estimated-next-period cell lands in the
// visible October calendar, and the arithmetic model would call today (day 30 -> 2) "menstrual", so any
// stale guard that stops working shows up on the calendar, the wheel, the hero and the Todo hint.
const STALE_YESTERDAY = [cycle('a', '2026-09-14', '2026-09-18')];
const DUE_TODAY = [cycle('a', '2026-09-15', '2026-09-19')]; // predicted 2026-10-13: due today is still current, not stale

beforeEach(async () => {
  jest.useRealTimers();
  setNow(2026, 10, 13);
  await i18n.changeLanguage('en');
  setCycles([]);
  useEnabledModulesStore.setState({ enablement: {} });
});
afterEach(() => { try { act(() => tree?.unmount()); } catch { /* already unmounted */ } jest.useRealTimers(); });

describe('APP-075 rendered Cycle screen', () => {
  it('assigns no reproductive phase when nothing has been logged', async () => {
    await render(<CycleScreen />);
    const list = texts();

    expect(list).toContain(i18n.t('cycle.heroNoData'));
    expect(list).toContain(i18n.t('cycle.noDataShort'));
    // getCurrentPhase() answers "follicular" for an empty history; that must never reach the screen.
    expect(list).not.toContain(i18n.t('cycle.phase.follicular'));
    expect(list).not.toContain(i18n.t('cycle.phase.luteal'));
    expect(list).not.toContain(i18n.t('cycle.phase.menstrual'));
  });

  it('keeps an open logged period observed, never "estimated"', async () => {
    setCycles(OPEN_PERIOD);
    await render(<CycleScreen />);
    const list = texts();

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 3 }));
    expect(list).toContain(i18n.t('cycle.phase.menstrual')); // hero phase
    expect(list).toContain(i18n.t('cycle.onPeriodShort')); // status
    expect(list).not.toContain(i18n.t('cycle.phaseEstimated.menstrual'));
    // Hero + status card (+ the calendar legend): the next-period date is an estimate even mid-period.
    expect(list.filter((line) => line === i18n.t('cycle.nextPeriodLabel')).length).toBeGreaterThanOrEqual(2);
  });

  it('frames an inferred phase and the next-period date as estimates', async () => {
    setCycles(COMPLETED_PERIOD);
    await render(<CycleScreen />);
    const list = texts();

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 13 })); // calendar arithmetic stays plain
    expect(list).toContain(i18n.t('cycle.phase.fertile')); // "Estimated fertile window"
    expect(list).not.toContain(i18n.t('cycle.phase.menstrual'));
    expect(list.filter((line) => line === i18n.t('cycle.nextPeriodLabel')).length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['en', /Do not use these estimates as contraception/, /logged cycles and current cycle settings/, /inaccurate/],
    ['da', /Brug ikke estimaterne som prævention/, /registrerede cyklusser og aktuelle cyklusindstillinger/, /upræcise/],
  ])('renders the full %s no-contraception boundary between the calendar and the wheel', async (language, notContraception, basis, inaccurate) => {
    await i18n.changeLanguage(language);
    setCycles(COMPLETED_PERIOD);
    await render(<CycleScreen />);
    const list = texts();
    const warning = list.findIndex((line) => notContraception.test(line));

    expect(warning).toBeGreaterThan(-1);
    expect(list[warning]).toMatch(basis);
    expect(list[warning]).toMatch(inaccurate);
    expect(list.indexOf(i18n.t('cycle.legendPeriod'))).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(list.indexOf(i18n.t('cycle.legendPeriod'))); // after the calendar legend
    expect(warning).toBeLessThan(list.indexOf(i18n.t('cycle.cycleWheelLabel'))); // before the wheel
  });

  it.each([['en', 'Estimate needs updating'], ['da', 'Estimat skal opdateres']])('removes stale %s predictions from current guidance while retaining cycle day', async (language, safeText) => {
    await i18n.changeLanguage(language);
    setCycles(STALE_PERIOD);
    await render(<CycleScreen />);
    const list = texts();

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 43 }));
    expect(list).toContain(safeText);
    // Estimate names and glyphs remain in the legend, but no calculated calendar day is exposed.
    const dayLabels = accessibleGroups().map((node) => node.props.accessibilityLabel);
    for (const type of ['fertile', 'ovulation', 'predicted']) {
      expect(dayLabels.some((label) => label.includes(i18n.t(`cycle.calendarMarker.${type}`)))).toBe(false);
    }
    expect(list).not.toContain(new Intl.DateTimeFormat(language === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short' }).format(new Date('2026-09-29')));
    expect(list.filter((line) => line === i18n.t('cycle.trackingDisclaimer'))).toHaveLength(1);
  });

  it.each([['en', 'Estimate needs updating'], ['da', 'Estimat skal opdateres']])('leaks no calculated guidance into hero, status, calendar or wheel when the %s estimate passed yesterday', async (language, safeText) => {
    await i18n.changeLanguage(language);
    setCycles(STALE_YESTERDAY);
    await render(<CycleScreen />);
    const list = texts();
    const labels = accessibleGroups().map((node) => node.props.accessibilityLabel as string);

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 30 }));
    expect(list).toContain(safeText);
    // No inferred phase in hero or status ("fertile" is also a legend key, so it may appear exactly once, as the legend).
    for (const phase of ['menstrual', 'follicular', 'luteal']) {
      expect(list).not.toContain(i18n.t(`cycle.phase.${phase}`));
      expect(list).not.toContain(i18n.t(`cycle.phaseEstimated.${phase}`));
    }
    expect(list.filter((line) => line === i18n.t('cycle.phase.fertile'))).toHaveLength(1);
    // Wheel: only the logged-start cycle day, no countdown and no phase caption.
    expect(svgTexts().filter(Boolean)).toEqual(['30', i18n.t('cycle.wheelDayLabel')]);
    // Calendar: the stale estimate drew no estimated cell in October, and both groups announce the stale state.
    for (const type of ['fertile', 'ovulation', 'predicted']) {
      expect(labels.some((label) => label.includes(i18n.t(`cycle.calendarMarker.${type}`)))).toBe(false);
    }
    expect(labels).toContain(i18n.t('cycle.calendarStaleA11ySummary'));
    expect(labels).toContain(i18n.t('cycle.wheelStaleA11ySummary'));
    expect(labels).not.toContain(i18n.t('cycle.calendarA11ySummary'));
    expect(labels).not.toContain(i18n.t('cycle.wheelA11ySummary'));
  });

  it('treats an estimate dated today as current: dated, countdown-free, and not marked for updating', async () => {
    setCycles(DUE_TODAY);
    await render(<CycleScreen />);
    const list = texts();
    const labels = accessibleGroups().map((node) => node.props.accessibilityLabel as string);

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 29 }));
    expect(list).not.toContain(i18n.t('cycle.predictionNeedsUpdating'));
    expect(list).toContain('Oct 13');
    expect(labels).toContain(i18n.t('cycle.calendarDayA11y', { day: 13, marker: i18n.t('cycle.calendarMarker.predicted') }));
    expect(labels).toContain(i18n.t('cycle.wheelA11ySummary'));
    expect(svgTexts()).not.toContain(i18n.t('cycle.daysUntilNext', { days: 0 })); // never "Estimated in 0 days"
  });

  it.each([['en'], ['da']])('keeps an open logged period observed when its calculated prediction is stale (%s)', async (language) => {
    await i18n.changeLanguage(language);
    setCycles([cycle('a', '2026-09-01')]); // open since 2026-09-01: day 43, calculated next period 2026-09-29 already passed
    await render(<CycleScreen />);
    const list = texts();

    expect(list).toContain(i18n.t('cycle.heroDayLabel', { day: 43 }));
    expect(list).toContain(i18n.t('cycle.phase.menstrual')); // hero phase stays the logged state
    expect(list).toContain(i18n.t('cycle.onPeriodShort')); // status stays the logged state
    expect(list).not.toContain(i18n.t('cycle.phaseEstimated.menstrual'));
    // The calculated part is the only thing withdrawn: no date, no label that calls it the next period.
    expect(list).toContain(i18n.t('cycle.predictionNeedsUpdating'));
    expect(list).toContain(i18n.t('cycle.predictionStatusLabel'));
    // Only the calendar legend key still uses the "estimated next period" wording; hero and status do not.
    expect(list.filter((line) => line === i18n.t('cycle.nextPeriodLabel'))).toHaveLength(1);
    expect(list).not.toContain(new Intl.DateTimeFormat(language === 'da' ? 'da-DK' : 'en-US', { day: 'numeric', month: 'short' }).format(new Date('2026-09-29')));
  });

  it.each([['en'], ['da']])('renders the symptom observation as an entry-only statement in %s', async (language) => {
    await i18n.changeLanguage(language);
    setSymptomLogs([
      { id: 'a', date: '2026-08-01', symptoms: ['cramps'] },
      { id: 'b', date: '2026-09-01', symptoms: ['cramps'] },
      { id: 'c', date: '2026-10-01', symptoms: ['cramps'] },
    ]);
    await render(<CycleScreen />);
    const observation = texts().find((line) => line.includes(i18n.t('cycle.symptoms.cramps').toLowerCase()));

    expect(observation).toContain(i18n.t('cycle.patternObservationBody', { symptom: i18n.t('cycle.symptoms.cramps').toLowerCase(), months: 3 }));
    expect(observation).not.toMatch(/doctor|læge/i);
  });
});

describe('APP-075 calendar', () => {
  it('names every marker and keeps the logged period apart from the three estimates', async () => {
    await render(<CycleMonthCalendar cycles={COMPLETED_PERIOD} fertileWindow={null} predictedNext={null} />);
    const list = texts();

    expect(list).toEqual(expect.arrayContaining([
      i18n.t('cycle.legendPeriod'),
      i18n.t('cycle.legendFertile'),
      i18n.t('cycle.legendOvulation'),
      i18n.t('cycle.legendPredictedPeriod'),
    ]));
    expect(i18n.t('cycle.legendPeriod')).not.toMatch(/estimated/i);
    for (const key of ['legendFertile', 'legendOvulation', 'legendPredictedPeriod']) {
      expect(i18n.t(`cycle.${key}`)).toMatch(/estimated/i);
    }
  });

  it('gives the two warm-coloured estimate markers different swatches', async () => {
    await render(<CycleMonthCalendar cycles={COMPLETED_PERIOD} fertileWindow={null} predictedNext={null} />);
    const dots = tree.root
      .findAll((node) => typeof node.type === 'string' && JSON.stringify(node.props.style ?? '').includes('"width":9'))
      .map((node) => JSON.stringify(node.props.style));

    expect(dots).toHaveLength(4);
    expect(dots[2]).not.toEqual(dots[3]); // ovulation vs predicted next period must not be identical dots
  });

  it('renders a distinct non-colour marker and accessibility label for each calendar meaning', async () => {
    await render(<CycleMonthCalendar
      cycles={COMPLETED_PERIOD}
      fertileWindow={{ start: '2026-10-10', end: '2026-10-16', ovulation: '2026-10-15' }}
      predictedNext="2026-10-29"
    />);

    // The legend carries one of each glyph; a day cell must carry its own, so every glyph appears more than once.
    for (const glyph of ['●', '≈', '○', '◇']) {
      expect(texts().filter((line) => line === glyph).length).toBeGreaterThan(1);
    }
    const dayLabels = accessibleGroups().map((node) => node.props.accessibilityLabel);
    for (const type of ['period', 'fertile', 'ovulation', 'predicted']) {
      expect(dayLabels.some((label) => label.includes(i18n.t(`cycle.calendarMarker.${type}`)))).toBe(true);
    }
  });

  it.each([['en', /estimates/], ['da', /estimater/]])('exposes the %s estimate summary as one accessible group', async (language, estimate) => {
    await i18n.changeLanguage(language);
    await render(<CycleMonthCalendar cycles={COMPLETED_PERIOD} fertileWindow={null} predictedNext={null} />);

    const group = accessibleGroups().find((node) => node.props.accessibilityLabel === i18n.t('cycle.calendarA11ySummary'));
    expect(group).toBeDefined();
    expect(group!.props.accessibilityLabel).toMatch(estimate);
  });
});

describe('APP-075 wheel', () => {
  const wheel = (cycleDay: number | null, daysUntilNext: number | null) => (
    <CycleWheel
      cycleDay={cycleDay}
      avgCycleLength={28}
      periodLength={5}
      fertileStartDay={cycleDay === null ? null : 9}
      fertileEndDay={cycleDay === null ? null : 15}
      daysUntilNext={daysUntilNext}
      getPhaseLabelForOffset={(offset) => (cycleDay === null ? '' : i18n.t('cycle.phaseEstimated.fertile') + offset)}
      locale="en-US"
    />
  );

  it.each([['en', /estimates/], ['da', /estimater/]])('exposes the %s estimate summary on the SVG itself', async (language, estimate) => {
    await i18n.changeLanguage(language);
    await render(wheel(10, 5));

    const svg = accessibleGroups().find((node) => hostName(node) === 'RNSVGSvgView');
    expect(svg).toBeDefined();
    expect(svg!.props.accessibilityLabel).toBe(i18n.t('cycle.wheelA11ySummary'));
    expect(svg!.props.accessibilityLabel).toMatch(estimate);
  });

  it('never draws the next-period countdown without the estimate wording', async () => {
    await render(wheel(10, 5));

    expect(svgTexts()).toContain(i18n.t('cycle.daysUntilNext', { days: 5 }));
    expect(i18n.t('cycle.daysUntilNext', { days: 5 })).toMatch(/estimated/i);
  });

  it('still renders, with no countdown and no day, when nothing is logged', async () => {
    await render(wheel(null, null));

    expect(svgTexts()).toContain('–');
    expect(svgTexts().some((line) => /estimated/i.test(line))).toBe(false);
    expect(accessibleGroups().some((node) => hostName(node) === 'RNSVGSvgView')).toBe(true);
  });

  it('uses the stale estimate accessibility state without a countdown or phase guidance', async () => {
    await render(<CycleWheel
      cycleDay={43}
      avgCycleLength={28}
      periodLength={5}
      fertileStartDay={null}
      fertileEndDay={null}
      daysUntilNext={null}
      predictionIsStale
      getPhaseLabelForOffset={() => ''}
      locale="en-US"
    />);

    const svg = accessibleGroups().find((node) => hostName(node) === 'RNSVGSvgView');
    expect(svg!.props.accessibilityLabel).toBe(i18n.t('cycle.wheelStaleA11ySummary'));
    expect(svgTexts()).not.toContain(i18n.t('cycle.daysUntilNext', { days: -14 }));
    expect(svgTexts().some((line) => /fertile|ovulation/i.test(line))).toBe(false);
  });
});

describe('APP-075 Home', () => {
  it('shows no cycle day or countdown with an empty history', async () => {
    const snapshot = await cycleHomeSnapshot();

    expect(snapshot).toMatchObject({ helperKey: 'home.cycleSnapshotMissing' });
    expect(snapshot?.value).toBeUndefined();
    expect(snapshot?.helperParams).toBeUndefined();
  });

  it.each([['en', /^Estimated /], ['da', /^Estimeret /]])('keeps the cycle day plain and the %s countdown helper an estimate', async (language, estimate) => {
    await i18n.changeLanguage(language);
    setCycles(OPEN_PERIOD);
    const snapshot = await cycleHomeSnapshot();

    expect(snapshot?.value).toBe('3'); // arithmetic from the logged start, not a prediction
    expect(snapshot?.helperKey).toBe('home.cycleSnapshotHelper');
    expect(i18n.t(snapshot!.helperKey!, snapshot!.helperParams)).toMatch(estimate);
  });

  it('treats an estimate dated today as current: a zero countdown, never the stale state or a negative number', async () => {
    setCycles(DUE_TODAY);
    const snapshot = await cycleHomeSnapshot();

    expect(snapshot).toMatchObject({ value: '29', helperKey: 'home.cycleSnapshotHelper', helperParams: { days: 0 } });
  });

  it('keeps an estimate that passed yesterday out of the Home countdown', async () => {
    setCycles(STALE_YESTERDAY);
    const snapshot = await cycleHomeSnapshot();

    expect(snapshot).toMatchObject({ value: '30', helperKey: 'home.cycleSnapshotStale' });
    expect(snapshot?.helperParams).toBeUndefined();
  });

  it.each([['en', 'Estimate needs updating'], ['da', 'Estimat skal opdateres']])('keeps a stale %s prediction out of the Home countdown', async (language, expected) => {
    await i18n.changeLanguage(language);
    setCycles(STALE_PERIOD);
    const snapshot = await cycleHomeSnapshot();

    expect(snapshot).toMatchObject({ value: '43', helperKey: 'home.cycleSnapshotStale' });
    expect(snapshot?.helperParams).toBeUndefined();
    expect(i18n.t(snapshot!.helperKey!)).toBe(expected);
  });
});

describe('APP-075 Todo hint', () => {
  const pickToday = async () => {
    const chip = tree.root.findAllByType(Chip).find((candidate) => candidate.props.label === i18n.t('todos.dueShortcutToday'));
    expect(chip).toBeDefined();
    await act(async () => { chip!.props.onPress(); });
  };

  it('is an uncertain, informational hint when the user has chosen the Cycle module', async () => {
    useEnabledModulesStore.setState({ enablement: { cycle: true } });
    setCycles(OPEN_PERIOD);
    await render(<NewTodoScreen />);
    await pickToday();

    const hint = i18n.t('todos.dueDatePhaseHint');
    expect(texts()).toContain(hint);
    expect(hint).toMatch(/estimate/i);
    expect(hint).toMatch(/\bmay\b/);
  });

  it('is not shown while the Cycle module is off', async () => {
    setCycles(OPEN_PERIOD); // module never chosen: health modules default to off
    await render(<NewTodoScreen />);
    await pickToday();

    expect(texts()).not.toContain(i18n.t('todos.dueDatePhaseHint'));
  });

  it('is not shown without any logged cycle', async () => {
    useEnabledModulesStore.setState({ enablement: { cycle: true } });
    await render(<NewTodoScreen />);
    await pickToday();

    expect(texts()).not.toContain(i18n.t('todos.dueDatePhaseHint'));
  });

  it('does not show a current due-date hint when the prediction basis is stale', async () => {
    useEnabledModulesStore.setState({ enablement: { cycle: true } });
    setCycles(STALE_PERIOD);
    await render(<NewTodoScreen />);
    await pickToday();

    expect(texts()).not.toContain(i18n.t('todos.dueDatePhaseHint'));
  });

  it('still shows the uncertain hint when the estimate is dated today (not yet stale)', async () => {
    useEnabledModulesStore.setState({ enablement: { cycle: true } });
    setCycles(DUE_TODAY);
    await render(<NewTodoScreen />);
    await pickToday();

    expect(texts()).toContain(i18n.t('todos.dueDatePhaseHint'));
  });

  it('withholds the hint for a stale prediction even where the arithmetic model would call the due date "period"', async () => {
    // Guard against a vacuous test: without the stale rule this exact state does produce a menstrual hint.
    expect(getPhaseForDate('2026-10-13', STALE_YESTERDAY, 28, 5, 14)).toBe('menstrual');
    useEnabledModulesStore.setState({ enablement: { cycle: true } });
    setCycles(STALE_YESTERDAY);
    await render(<NewTodoScreen />);
    await pickToday();

    expect(texts()).not.toContain(i18n.t('todos.dueDatePhaseHint'));
  });
});
