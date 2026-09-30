import i18n from "@/localization/i18n";
import * as Notifications from "expo-notifications";

import { Warranty } from "@/types/warranty";
import { addDaysIso, parseCalendarDate } from "@/utils/shared/localDate";

const REMINDER_OFFSETS = [30, 7, 1]; // dage før udløb
const REMINDER_HOUR = 9;

function reminderId(warrantyId: string, daysBefore: number) {
  return `warranty-${warrantyId}-${daysBefore}`;
}

/**
 * Alle garantipåmindelses-operationer kører én ad gangen, i den rækkefølge de
 * blev bedt om. Ellers kunne opfriskningen ved opstart (nedenfor) planlægge ud fra
 * en garanti, brugeren i samme øjeblik ændrer eller sletter — og efterlade
 * påmindelser for en gammel dato eller en slettet garanti. En fejl i én
 * operation stopper ikke de næste.
 */
let lane: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = lane.then(task, task);
  lane = run.catch(() => undefined);
  return run;
}

export type WarrantyReminderOccurrence = {
  daysBefore: number;
  /** Kalenderdagen for påmindelsen, 'YYYY-MM-DD'. */
  date: string;
  /** Kl. 09:00 lokal tid den dag. */
  trigger: Date;
};

/**
 * APP-057: påmindelserne afledes KUN af den kanoniske dækningsslutdato og regnes i
 * kalenderdage (utils/shared/localDate.ts), ikke i millisekunder. Tidspunktet
 * bygges af datoens egne felter i lokal tid, så hverken UTC-fortolkning af
 * 'YYYY-MM-DD' eller sommertid kan flytte påmindelsen til en anden dag.
 *
 * En dato der ikke er en gyldig kalenderdato giver ingen påmindelser — den
 * gættes ikke om til en anden. Passerede tidspunkter springes over.
 */
export function warrantyReminderOccurrences(coverageEnd: string, now: number = Date.now()): WarrantyReminderOccurrence[] {
  if (parseCalendarDate(coverageEnd) === null) return [];

  return REMINDER_OFFSETS.flatMap((daysBefore) => {
    const date = addDaysIso(coverageEnd, -daysBefore);
    const { year, month, day } = parseCalendarDate(date)!;
    const trigger = new Date(year, month - 1, day, REMINDER_HOUR, 0, 0, 0);
    return trigger.getTime() <= now ? [] : [{ daysBefore, date, trigger }];
  });
}

function cancelAllOffsets(warrantyId: string) {
  return REMINDER_OFFSETS.map((offset) =>
    Notifications.cancelScheduledNotificationAsync(reminderId(warrantyId, offset)),
  );
}

/**
 * Den eneste måde en garantipåmindelse planlægges på. Teksten er bevidst generisk:
 * en låseskærm skal ikke fortælle, hvad man har købt, hvor, eller hvilken
 * kvittering der hører til. Derfor kender den hverken produktnavn, sælger, noter
 * eller dokument — kun id og dato.
 */
function scheduleGeneric(warrantyId: string, { daysBefore, trigger }: WarrantyReminderOccurrence) {
  return Notifications.scheduleNotificationAsync({
    identifier: reminderId(warrantyId, daysBefore),
    content: {
      title: i18n.t("warranties.reminderGenericTitle"),
      body: i18n.t("warranties.reminderGenericBody", { count: daysBefore }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: trigger,
    },
  });
}

/** Planlægger påmindelserne for én garanti ud fra dens dækningsslutdato. */
export async function scheduleWarrantyReminder(
  warrantyId: string,
  coverageEnd: string,
) {
  // Uden for køen: dialogen kan vente på brugeren, og det må ikke holde andre
  // garantipåmindelser tilbage.
  await Notifications.requestPermissionsAsync();

  return serialized(async () => {
    // Ryd alle tidligere planlagte påmindelser for denne garanti, uanset hvilke offsets de havde
    await Promise.all(cancelAllOffsets(warrantyId));

    for (const occurrence of warrantyReminderOccurrences(coverageEnd)) {
      await scheduleGeneric(warrantyId, occurrence);
    }
  });
}

export function cancelWarrantyReminder(warrantyId: string) {
  return serialized(async () => {
    await Promise.all(cancelAllOffsets(warrantyId));
  });
}

export type WarrantyReminderRefresh = {
  /** 'granted' only when the OS already said yes; nothing here ever asks. */
  permission: "granted" | "not-granted" | "unknown";
  cancelled: number;
  scheduled: number;
  /** Notification calls that failed and were contained. */
  failures: number;
};

/**
 * APP-057: erstat de påmindelser tidligere versioner planlagde — med produktnavnet
 * i titlen — med de generiske, for hver garanti i den lokale, krypterede liste.
 *
 * Kører ved opstart/login, efter listen er læst fra disken, og afhænger ikke af
 * netværket. Identifikatorerne er de samme deterministiske `warranty-<id>-<dage>`,
 * som alle versioner har brugt, så de gamle kan findes og ryddes.
 *
 * Den spørger ALDRIG om tilladelse. En opdatering af appen er ikke en grund til en
 * dialog. Rydningen sker altid — at aflyse kræver ingen tilladelse, og en gammel
 * påmindelse kunne ellers vise sit navn, hvis tilladelsen senere slås til. Nye
 * påmindelser planlægges kun, hvis tilladelsen allerede er givet.
 *
 * Den kaster aldrig: hver notifikationskald er afgrænset for sig, og resultatet
 * er tal — ingen id'er, navne eller datoer. Kan køres igen og igen med samme
 * udfald. Dette er ikke en notifikationsplatform (APP-079/080).
 */
export function refreshWarrantyReminders(
  readWarranties: () => readonly Pick<Warranty, "id" | "expiryDate">[],
): Promise<WarrantyReminderRefresh> {
  return serialized(async () => {
    const result: WarrantyReminderRefresh = { permission: "unknown", cancelled: 0, scheduled: 0, failures: 0 };

    let warranties: readonly Pick<Warranty, "id" | "expiryDate">[];
    try {
      warranties = readWarranties();
    } catch {
      return result;
    }

    const cancels = await Promise.allSettled(
      warranties.flatMap((warranty) =>
        REMINDER_OFFSETS.map(async (offset) =>
          Notifications.cancelScheduledNotificationAsync(reminderId(warranty.id, offset)),
        ),
      ),
    );
    for (const outcome of cancels) {
      if (outcome.status === "fulfilled") result.cancelled += 1;
      else result.failures += 1;
    }

    try {
      result.permission = (await Notifications.getPermissionsAsync()).granted === true ? "granted" : "not-granted";
    } catch {
      result.failures += 1;
      return result;
    }
    if (result.permission !== "granted") return result;

    const now = Date.now();
    for (const warranty of warranties) {
      for (const occurrence of warrantyReminderOccurrences(warranty.expiryDate, now)) {
        try {
          await scheduleGeneric(warranty.id, occurrence);
          result.scheduled += 1;
        } catch {
          result.failures += 1;
        }
      }
    }
    return result;
  });
}
