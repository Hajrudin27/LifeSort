import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import {
  APPLICATION_STATUSES,
  MAX_NOTES_LENGTH,
  type ApplicationErrors,
  type ApplicationField,
  type ApplicationInput,
} from '@/features/career/domain/application';
import type { ApplicationStatus } from '@/types/career';
import { todayIso } from '@/utils/shared/localDate';

type Props = {
  initial?: {
    company: string;
    position: string;
    status: ApplicationStatus;
    appliedDate: string;
    link?: string;
    notes?: string;
  };
  /** Returns the field errors, or null once the application has been saved. */
  onSubmit: (input: ApplicationInput) => ApplicationErrors | null;
};

/**
 * APP-067 — the one Career application form, used by "new" and "edit".
 *
 * It owns text and error presentation only. Every rule lives in features/career/domain and is
 * applied by the store; the form never decides what is valid and never saves anything itself.
 */
export default function ApplicationForm({ initial, onSubmit }: Props) {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textColor = useThemeColor({}, 'text');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const [company, setCompany] = useState(initial?.company ?? '');
  const [position, setPosition] = useState(initial?.position ?? '');
  const [status, setStatus] = useState<ApplicationStatus>(initial?.status ?? 'applied');
  const [appliedDate, setAppliedDate] = useState(initial?.appliedDate ?? todayIso());
  const [link, setLink] = useState(initial?.link ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [errors, setErrors] = useState<ApplicationErrors>({});

  const clear = (field: ApplicationField) => {
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  const save = () => {
    const failed = onSubmit({ company, position, status, appliedDate, link, notes });
    if (failed) setErrors(failed);
  };

  const inputStyle = [sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }];
  const errorText = (field: ApplicationField) =>
    errors[field] ? (
      <Text accessibilityLiveRegion="polite" style={{ color: danger, fontSize: 13 }}>
        {t(`career.errors.${errors[field]}`)}
      </Text>
    ) : null;
  const errorStyle = (field: ApplicationField) => (errors[field] ? { borderColor: danger } : null);

  return (
    <>
      <Card style={sharedStyles.card}>
        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.companyLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('company')]}
            accessibilityLabel={t('career.companyLabel')}
            accessibilityHint={errors.company ? t(`career.errors.${errors.company}`) : undefined}
            placeholder={t('career.companyPlaceholder')}
            placeholderTextColor={textMuted}
            value={company}
            onChangeText={(value) => {
              setCompany(value);
              clear('company');
            }}
            autoCapitalize="words"
            returnKeyType="next"
          />
          {errorText('company')}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.positionLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('position')]}
            accessibilityLabel={t('career.positionLabel')}
            accessibilityHint={errors.position ? t(`career.errors.${errors.position}`) : undefined}
            placeholder={t('career.positionPlaceholder')}
            placeholderTextColor={textMuted}
            value={position}
            onChangeText={(value) => {
              setPosition(value);
              clear('position');
            }}
            autoCapitalize="sentences"
            returnKeyType="next"
          />
          {errorText('position')}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.appliedDateLabel')}</Text>
          <DatePickerField
            value={appliedDate}
            accessibilityLabel={t('career.appliedDateLabel')}
            onChange={(value) => {
              setAppliedDate(value);
              clear('appliedDate');
            }}
          />
          {errorText('appliedDate')}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.statusLabel')}</Text>
          <View accessibilityRole="radiogroup" style={sharedStyles.chipRow}>
            {APPLICATION_STATUSES.map((s) => (
              <Chip
                key={s}
                label={t(`career.status.${s}`)}
                active={status === s}
                accessibilityRole="radio"
                accessibilityState={{ checked: status === s, selected: status === s }}
                style={{ minHeight: 44, justifyContent: 'center' }}
                onPress={() => {
                  setStatus(s);
                  clear('status');
                }}
              />
            ))}
          </View>
          {errorText('status')}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.linkLabel')}</Text>
          <TextInput
            style={[inputStyle, errorStyle('link')]}
            accessibilityLabel={t('career.linkLabel')}
            accessibilityHint={errors.link ? t(`career.errors.${errors.link}`) : undefined}
            placeholder={t('career.linkPlaceholder')}
            placeholderTextColor={textMuted}
            value={link}
            onChangeText={(value) => {
              setLink(value);
              clear('link');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="next"
          />
          {errorText('link')}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={sharedStyles.fieldLabel}>{t('career.notesLabel')}</Text>
          <TextInput
            style={[inputStyle, sharedStyles.inputMultiline, errorStyle('notes')]}
            accessibilityLabel={t('career.notesLabel')}
            accessibilityHint={errors.notes ? t(`career.errors.${errors.notes}`) : undefined}
            placeholder={t('career.notesPlaceholder')}
            placeholderTextColor={textMuted}
            value={notes}
            onChangeText={(value) => {
              setNotes(value);
              clear('notes');
            }}
            multiline
            autoCapitalize="sentences"
            scrollEnabled={false}
          />
          <Text style={{ color: textMuted, fontSize: 12 }}>
            {t('career.notesCounter', { count: notes.length, max: MAX_NOTES_LENGTH })}
          </Text>
          {errorText('notes')}
        </View>
      </Card>

      {Object.keys(errors).length > 0 && (
        <Text accessibilityLiveRegion="polite" style={{ color: danger }}>
          {t('career.saveFailed')}
        </Text>
      )}
      <Button label={t('career.save')} onPress={save} />
    </>
  );
}
