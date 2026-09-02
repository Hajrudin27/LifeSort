import { PackingCategory } from '@/types/trip';

export const PACKING_CATEGORIES: PackingCategory[] = ['essentials', 'clothing', 'electronics', 'toiletries', 'other'];

export function getPackingCategoryIcon(category: PackingCategory): { ios: string; android: string; web: string } {
  switch (category) {
    case 'essentials':
      return { ios: 'key.fill', android: 'vpn_key', web: 'vpn_key' };
    case 'clothing':
      return { ios: 'tshirt.fill', android: 'checkroom', web: 'checkroom' };
    case 'electronics':
      return { ios: 'bolt.fill', android: 'bolt', web: 'bolt' };
    case 'toiletries':
      return { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' };
    default:
      return { ios: 'bag.fill', android: 'luggage', web: 'luggage' };
  }
}