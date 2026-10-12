import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { minorUnitsToInputText } from '@/core/money/decimal';
import { decimalSeparatorFor, moneyLocaleFor } from '@/core/money/format';
import { isContactPickerSupported, pickContactName } from '@/features/gifts/contacts/pickContactName';
import type { GiftErrors, GiftField, GiftInput } from '@/features/gifts/domain/gift';
import type { Gift } from '@/types/gift';
import { todayIso } from '@/utils/shared/localDate';

type Props = {
  /** The gift being edited. Absent when creating. */
  initial?: Gift;
  submitLabel: string;
  /** Returns the field errors, or null once the gift has been saved. */
  onSubmit: (input: GiftInput) => GiftErrors | null;
};

/**
 * The year window the date picker must offer so that any stored date can be shown and re-chosen,
 * however far from today (the picker's own default is 80 years back and 10 forward).
 */
function pickerWindow(value: string): { yearsBack: number; yearsForward: number } {
  const year = Number(value.slice(0, 4));
  const current = Number(todayIso().slice(0, 4));
  return {
    yearsBack: Math.max(80, Number.isFinite(year) ? current - year : 0),
    yearsForward: Math.max(10, Number.isFinite(year) ? year - current : 0),
  };
}

/**
 * APP-069 — the one Gift form, used by "new" and by the edit screen.
 *
 * It owns text and error presentation only. Every rule lives in features/gifts/domain and is applied
 * by the store; the form never decides what is valid and never saves anything itself.
 *
 * APP-070: on iOS only, the Person field has an optional "Choose from Contacts" action. It copies the picked
 * name's text into the field, one way, and nothing else: it saves nothing, keeps no reference to the contact,
 * and the text is then ordinary, editable form input checked by the normal rules on Save.
 *
 * Budget and Paid are two different things and are labelled as such: what the user plans to spend,
 * and what was actually paid. Neither is an expense, and the form says so next to the purchase.
 */
export default function GiftForm({ initial, submitLabel, onSubmit }: Props) {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textColor = useThemeColor({}, 'text');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const separator = decimalSeparatorFor(moneyLocaleFor(i18n.language));

  const [personLabel, setPersonLabel] = useState(initial?.personLabel ?? '');
  const [idea, setIdea] = useState(initial?.idea ?? '');
  const [occasionLabel, setOccasionLabel] = useState(initial?.occasionLabel ?? '');
  const [occasionDate, setOccasionDate] = useState(initial?.occasionDate ?? '');
  const [budget, setBudget] = useState(initial?.budget !== undefined ? minorUnitsToInputText(initial.budget, separator) : '');
  const [purchased, setPurchased] = useState(initial?.purchasedOn !== undefined);
  const [purchasedOn, setPurchasedOn] = useState(initial?.purchasedOn ?? '');
  const [paid, setPaid] = useState(initial?.paid !== undefined ? minorUnitsToInputText(initial.paid, separator) : '');
  const [errors, setErrors] = useState<GiftErrors>({});
  const [picking, setPicking] = useState(false);
  const [contactNotice, setContactNotice] = useState<'no_name' | 'unavailable' | 'error' | null>(null);
  const contactPickerShown = isContactPickerSupported();

  const clear = (field: GiftField) => {
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  const togglePurchased = (next: boolean) => {
    setPurchased(next);
    // A convenience only: the date is shown, can be changed, and is saved only when the user saves.
    if (next && purchasedOn === '') setPurchasedOn(todayIso());
    clear('purchasedOn');
    clear('paid');
  };

  const chooseContact = async () => {
    if (picking) return;
    setPicking(true);
    const result = await pickContactName();
    setPicking(false);
    if (result.ok) {
      setPersonLabel(result.name);
      clear('personLabel');
      setContactNotice(null);
    } else {
      // A cancelled picker is silent; the field is never changed by anything but a picked name.
      setContactNotice(result.reason === 'cancelled' ? null : result.reason);
    }
  };

  const save = () => {
    const failed = onSubmit({
      personLabel,
      idea,
      occasionLabel,
      occasionDate,
      budget,
      purchased,
      // Fields of a purchase that is switched off are not sent: switching it off removes them.
      purchasedOn: purchased ? purchasedOn : undefined,
      paid: purchased ? paid : undefined,
    });
    if (failed) setErrors(failed);
  };

  const inputStyle = [sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }];
  const errorText = (field: GiftField) =>
    errors[field] ? (
      <Text accessibilityLiveRegion="polite" style={{ color: danger, fontSize: 13 }}>
        {t(`gifts.errors.${errors[field]}`)}
      </Text>
    ) : null;
  const errorStyle = (field: GiftField) => (errors[field] ? { borderColor: danger } : null);
  const errorHint = (field: GiftField) => (errors[field] ? t(`gifts.errors.${errors[field]}`) : undefined);

  return (
    <>
      <Card style={sharedStyles.card}>
        <View style={styles.field}>
          <Text style={sharedStyles.fieldLabel}>{t('gifts.personLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('personLabel')]}
            accessibilityLabel={t('gifts.personLabel')}
            accessibilityHint={errorHint('personLabel')}
            placeholder={t('gifts.personPlaceholder')}
            placeholderTextColor={textMuted}
            value={personLabel}
            onChangeText={(value) => {
              setPersonLabel(value);
              clear('personLabel');
            }}
            autoCapitalize="words"
            returnKeyType="next"
          />
          {errorText('personLabel')}
          {contactPickerShown && (
            <>
              <Button
                label={t('gifts.chooseContact')}
                accessibilityLabel={t('gifts.chooseContact')}
                accessibilityHint={t('gifts.contactHelp')}
                variant="secondary"
                disabled={picking}
                style={styles.minTarget}
                onPress={chooseContact}
              />
              <Text style={[styles.help, { color: textMuted }]}>{t('gifts.contactHelp')}</Text>
              {contactNotice !== null && (
                <Text accessibilityLiveRegion="polite" style={[styles.help, { color: textMuted }]}>
                  {t(`gifts.contactNotice.${contactNotice}`)}
                </Text>
              )}
            </>
          )}
        </View>

        <View style={styles.field}>
          <Text style={sharedStyles.fieldLabel}>{t('gifts.ideaLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('idea')]}
            accessibilityLabel={t('gifts.ideaLabel')}
            accessibilityHint={errorHint('idea')}
            placeholder={t('gifts.ideaPlaceholder')}
            placeholderTextColor={textMuted}
            value={idea}
            onChangeText={(value) => {
              setIdea(value);
              clear('idea');
            }}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          {errorText('idea')}
        </View>

        <View style={styles.field}>
          <Text style={sharedStyles.fieldLabel}>{t('gifts.occasionLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('occasionLabel')]}
            accessibilityLabel={t('gifts.occasionLabel')}
            accessibilityHint={errorHint('occasionLabel')}
            placeholder={t('gifts.occasionPlaceholder')}
            placeholderTextColor={textMuted}
            value={occasionLabel}
            onChangeText={(value) => {
              setOccasionLabel(value);
              clear('occasionLabel');
            }}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          {errorText('occasionLabel')}
        </View>

        <View style={styles.field}>
          <Text style={sharedStyles.fieldLabel}>{t('gifts.occasionDateLabel')}</Text>
          {occasionDate === '' ? (
            <Button
              label={t('gifts.addDate')}
              accessibilityLabel={t('gifts.addDateA11y')}
              variant="secondary"
              style={styles.minTarget}
              onPress={() => {
                // Shown straight away and adjustable; it only counts once the gift is saved.
                setOccasionDate(todayIso());
                clear('occasionDate');
              }}
            />
          ) : (
            <>
              <DatePickerField
                value={occasionDate}
                accessibilityLabel={t('gifts.occasionDateLabel')}
                {...pickerWindow(occasionDate)}
                onChange={(value) => {
                  setOccasionDate(value);
                  clear('occasionDate');
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('gifts.removeDate')}
                onPress={() => {
                  setOccasionDate('');
                  clear('occasionDate');
                }}
                style={styles.removeDate}>
                <Text style={{ color: danger, fontWeight: '600' }}>{t('gifts.removeDate')}</Text>
              </Pressable>
            </>
          )}
          {errorText('occasionDate')}
        </View>

        <View style={styles.field}>
          <Text style={sharedStyles.fieldLabel}>{t('gifts.budgetLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('budget')]}
            accessibilityLabel={t('gifts.budgetLabel')}
            accessibilityHint={errorHint('budget') ?? t('gifts.budgetHelp')}
            placeholder={t('gifts.amountPlaceholder')}
            placeholderTextColor={textMuted}
            value={budget}
            onChangeText={(value) => {
              setBudget(value);
              clear('budget');
            }}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
          <Text style={[styles.help, { color: textMuted }]}>{t('gifts.budgetHelp')}</Text>
          {errorText('budget')}
        </View>
      </Card>

      <Card style={sharedStyles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={sharedStyles.fieldLabel}>{t('gifts.purchasedLabel')}</Text>
            {/* The state is written out, never carried by the switch colour alone. */}
            <Text style={{ color: textMuted, fontSize: 13 }}>
              {t(purchased ? 'gifts.purchasedStateOn' : 'gifts.purchasedStateOff')}
            </Text>
          </View>
          <Switch
            value={purchased}
            onValueChange={togglePurchased}
            accessibilityRole="switch"
            accessibilityLabel={t('gifts.purchasedLabel')}
            accessibilityState={{ checked: purchased }}
            style={styles.minTarget}
          />
        </View>
        <Text style={[styles.help, { color: textMuted }]}>{t('gifts.notAddedToExpenses')}</Text>

        {purchased && (
          <>
            <View style={styles.field}>
              <Text style={sharedStyles.fieldLabel}>{t('gifts.purchaseDateLabel')}</Text>
              <DatePickerField
                value={purchasedOn}
                accessibilityLabel={t('gifts.purchaseDateLabel')}
                {...pickerWindow(purchasedOn)}
                onChange={(value) => {
                  setPurchasedOn(value);
                  clear('purchasedOn');
                }}
              />
              {errorText('purchasedOn')}
            </View>

            <View style={styles.field}>
              <Text style={sharedStyles.fieldLabel}>{t('gifts.paidLabel')}</Text>
              <TextInput
                style={[inputStyle, errorStyle('paid')]}
                accessibilityLabel={t('gifts.paidLabel')}
                accessibilityHint={errorHint('paid') ?? t('gifts.paidHelp')}
                placeholder={t('gifts.amountPlaceholder')}
                placeholderTextColor={textMuted}
                value={paid}
                onChangeText={(value) => {
                  setPaid(value);
                  clear('paid');
                }}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text style={[styles.help, { color: textMuted }]}>{t('gifts.paidHelp')}</Text>
              {errorText('paid')}
            </View>
          </>
        )}
      </Card>

      {Object.keys(errors).length > 0 && (
        <Text accessibilityLiveRegion="polite" style={{ color: danger }}>
          {t('gifts.saveFailed')}
        </Text>
      )}
      <Button label={submitLabel} onPress={save} />
    </>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  help: { fontSize: 12, lineHeight: 17 },
  minTarget: { minHeight: 44, minWidth: 44 },
  removeDate: { minHeight: 44, justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
});
