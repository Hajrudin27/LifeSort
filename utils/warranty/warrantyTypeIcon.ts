export function getWarrantyTypeIconName(type: string): { ios: string; android: string; web: string } {
    switch (type) {
      case 'insurance':
        return { ios: 'shield.fill', android: 'security', web: 'security' };
      case 'rental':
        return { ios: 'key.fill', android: 'key', web: 'key' };
      case 'warranty':
        return { ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' };
      case 'receipt':
        return { ios: 'doc.text.fill', android: 'receipt_long', web: 'receipt_long' };
      default:
        return { ios: 'ellipsis.circle.fill', android: 'more_horiz', web: 'more_horiz' };
    }
  }