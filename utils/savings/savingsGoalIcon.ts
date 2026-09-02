import { SavingsGoalIcon } from '@/types/savingsGoal';

export const SAVINGS_GOAL_ICONS: SavingsGoalIcon[] = ['travel', 'home', 'car', 'gift', 'tech', 'emergency', 'longTerm', 'other'];

export function getIconSymbolName(icon: SavingsGoalIcon): { ios: string; android: string; web: string } {
  switch (icon) {
    case 'travel':
      return { ios: 'airplane', android: 'flight', web: 'flight' };
    case 'home':
      return { ios: 'house', android: 'home', web: 'home' };
    case 'car':
      return { ios: 'car', android: 'directions_car', web: 'directions_car' };
    case 'gift':
      return { ios: 'gift', android: 'redeem', web: 'redeem' };
    case 'tech':
      return { ios: 'laptopcomputer', android: 'laptop', web: 'laptop' };
    case 'emergency':
      return { ios: 'shield', android: 'shield', web: 'shield' };
    case 'longTerm':
      return { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' };
    case 'other':
    default:
      return { ios: 'banknote', android: 'savings', web: 'savings' };
  }
}