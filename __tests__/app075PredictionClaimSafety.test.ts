import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const json = (relativePath: string) => JSON.parse(source(relativePath)) as Record<string, any>;

const enCycle = json('localization/locales/en/cycle.json');
const daCycle = json('localization/locales/da/cycle.json');
const enHome = json('localization/locales/en/home.json');
const daHome = json('localization/locales/da/home.json');
const enTodos = json('localization/locales/en/todos.json');
const daTodos = json('localization/locales/da/todos.json');

describe('APP-075 prediction-claim presentation', () => {
  it('keeps logged menstrual data observed while naming inferred phases as estimates', () => {
    const screen = source('app/(tabs)/cycle.tsx');

    expect(screen).toContain('const onPeriod = isCurrentlyOnPeriod(cycles);');
    expect(screen).toContain('onPeriod ? t("cycle.onPeriodShort")');
    expect(enCycle.phase.menstrual).toBe('Menstrual');
    expect(daCycle.phase.menstrual).toBe('Menstruation');

    for (const phase of ['follicular', 'fertile', 'luteal']) {
      expect(enCycle.phase[phase]).toMatch(/estimated/i);
      expect(daCycle.phase[phase]).toMatch(/estimeret/i);
    }
  });

  it('uses explicit estimate semantics for the hero/status next-period date and countdown', () => {
    const screen = source('app/(tabs)/cycle.tsx');

    expect(screen).toContain('t("cycle.nextPeriodLabel")');
    expect(enCycle.nextPeriodLabel).toMatch(/estimated/i);
    expect(daCycle.nextPeriodLabel).toMatch(/estimeret/i);
    expect(enCycle.daysUntilNext).toMatch(/estimated/i);
    expect(daCycle.daysUntilNext).toMatch(/estimeret/i);
    expect(enCycle.startPeriodActionSubtitle).toMatch(/estimates/i);
    expect(daCycle.startPeriodActionSubtitle).toMatch(/estimerer/i);
  });

  it('places bilingual, not-for-contraception safety text between the calendar and wheel', () => {
    const screen = source('app/(tabs)/cycle.tsx');
    const calendar = screen.indexOf('<CycleMonthCalendar');
    const safety = screen.indexOf('cycle.trackingDisclaimer');
    const wheel = screen.indexOf('<CycleWheel');

    expect(calendar).toBeGreaterThan(-1);
    expect(safety).toBeGreaterThan(calendar);
    expect(wheel).toBeGreaterThan(safety);
    expect(enCycle.trackingDisclaimer).toMatch(/logged cycles and current cycle settings/i);
    expect(enCycle.trackingDisclaimer).toMatch(/not.*contraception/i);
    expect(daCycle.trackingDisclaimer).toMatch(/registrerede cyklusser og aktuelle cyklusindstillinger/i);
    expect(daCycle.trackingDisclaimer).toMatch(/prævention/i);
  });

  it('distinguishes logged periods from every calculated calendar marker and exposes an estimate summary', () => {
    const calendar = source('components/CycleMonthCalendar.tsx');

    expect(enCycle.legendPeriod).toBe('Logged period');
    expect(daCycle.legendPeriod).toBe('Registreret menstruation');
    for (const key of ['legendFertile', 'legendOvulation', 'legendPredictedPeriod']) {
      expect(enCycle[key]).toMatch(/estimated/i);
      expect(daCycle[key]).toMatch(/estimeret/i);
    }
    expect(calendar).toContain("cycle.calendarA11ySummary");
    expect(calendar).toContain("t('cycle.legendPredictedPeriod')");
    expect(enCycle.calendarA11ySummary).toMatch(/logged cycles and current cycle settings/i);
    expect(daCycle.calendarA11ySummary).toMatch(/registrerede cyklusser og aktuelle cyklusindstillinger/i);
  });

  it('makes wheel projections estimate-framed in both visible and accessibility output', () => {
    const screen = source('app/(tabs)/cycle.tsx');
    const wheel = source('components/CycleWheel.tsx');

    expect(screen).toContain('cycle.phaseEstimated.${phaseForOffset}');
    expect(wheel).toContain("cycle.wheelA11ySummary");
    expect(enCycle.wheelA11ySummary).toMatch(/logged cycles and current cycle settings/i);
    expect(daCycle.wheelA11ySummary).toMatch(/registrerede cyklusser og aktuelle cyklusindstillinger/i);
  });

  it('qualifies Home and Todo predictions independently of the Cycle screen', () => {
    const home = source('features/cycle/homeSnapshot.ts');
    const todo = source('app/todos/new.tsx');

    expect(home).toContain("predictionIsStale ? 'home.cycleSnapshotStale'");
    expect(enHome.cycleSnapshotHelper).toMatch(/estimated/i);
    expect(daHome.cycleSnapshotHelper).toMatch(/estimeret/i);
    expect(todo).toContain('todos.dueDatePhaseHint');
    expect(enTodos.dueDatePhaseHint).toMatch(/estimate/i);
    expect(enTodos.dueDatePhaseHint).toMatch(/may/i);
    expect(daTodos.dueDatePhaseHint).toMatch(/cyklusestimat/i);
    expect(daTodos.dueDatePhaseHint).toMatch(/kan/i);
  });

  it('keeps insights descriptive and non-medical while qualifying inferred phases', () => {
    const insights = source('components/CycleInsightsCard.tsx');

    expect(insights).toContain('cycle.phaseEstimated.${insight.phase}');
    expect(enCycle.insightsDisclaimer).toMatch(/not a medical assessment/i);
    expect(daCycle.insightsDisclaimer).toMatch(/ikke en medicinsk vurdering/i);
    expect(enCycle.insights.foodSpendingHigher).not.toMatch(/cause|because/i);
    expect(daCycle.insights.foodSpendingHigher).not.toMatch(/forårsag|fordi/i);
  });

  it('keeps generic reminders generic and rich reminders estimate-framed without fertility guidance', () => {
    const reminder = source('utils/cycle/cycleReminder.ts');
    const richEn = `${enCycle.reminderRichNotifTitle} ${enCycle.reminderRichNotifBody_one} ${enCycle.reminderRichNotifBody_other}`;
    const richDa = `${daCycle.reminderRichNotifTitle} ${daCycle.reminderRichNotifBody_one} ${daCycle.reminderRichNotifBody_other}`;

    expect(reminder).toContain("i18n.t('cycle.reminderGenericNotifTitle')");
    expect(reminder).toContain("i18n.t('cycle.reminderRichNotifTitle')");
    expect(enCycle.reminderGenericNotifTitle).toBe('LifeSort reminder');
    expect(daCycle.reminderGenericNotifTitle).toBe('Påmindelse fra LifeSort');
    expect(richEn).toMatch(/estimated/i);
    expect(richDa).toMatch(/estimer/);
    expect(richEn).not.toMatch(/fertil|ovulation/i);
    expect(richDa).not.toMatch(/fertil|ægløsning/i);
  });

  it('keeps symptom observations limited to the user’s own entries', () => {
    expect(enCycle.patternObservationBody).toMatch(/own entries/i);
    expect(daCycle.patternObservationBody).toMatch(/egne registreringer/i);
    expect(enCycle.patternObservationBody).not.toMatch(/doctor/i);
    expect(daCycle.patternObservationBody).not.toMatch(/læge/i);
  });
});
