import { useTranslation } from 'react-i18next';

import Chip from '@/components/Chip';
import { View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { SavingsGoalIcon } from '@/types/savingsGoal';
import { SAVINGS_GOAL_ICONS, getIconSymbolName } from '@/utils/savings/savingsGoalIcon';

type Props = {
  selected: SavingsGoalIcon;
  onSelect: (icon: SavingsGoalIcon) => void;
};

export default function SavingsIconPicker({ selected, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <View style={sharedStyles.chipRow}>
      {SAVINGS_GOAL_ICONS.map((icon) => (
        <Chip
          key={icon}
          label={t(`savings.icons.${icon}`)}
          icon={getIconSymbolName(icon)}
          stacked
          active={selected === icon}
          onPress={() => onSelect(icon)}
        />
      ))}
    </View>
  );
}