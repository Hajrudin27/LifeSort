export function getConditionIconName(id: string): { ios: string; android: string; web: string } {
    switch (id) {
      case 'endometriosis':
        return { ios: 'flame', android: 'local_fire_department', web: 'local_fire_department' };
      case 'pcos':
        return { ios: 'circle.hexagongrid', android: 'hexagon', web: 'hexagon' };
      case 'pms':
      case 'pmdd':
        return { ios: 'cloud.rain', android: 'cloud', web: 'cloud' };
      case 'dysmenorrhea':
        return { ios: 'bolt.heart', android: 'bolt', web: 'bolt' };
      case 'menorrhagia':
        return { ios: 'drop.triangle', android: 'water_drop', web: 'water_drop' };
      case 'amenorrhea':
        return { ios: 'calendar.badge.exclamationmark', android: 'event_busy', web: 'event_busy' };
      case 'fibroids':
      case 'ovarianCysts':
        return { ios: 'circle.grid.2x2', android: 'blur_circular', web: 'blur_circular' };
      case 'thyroidDisorders':
        return { ios: 'waveform.path.ecg', android: 'monitor_heart', web: 'monitor_heart' };
      case 'anemia':
        return { ios: 'battery.25', android: 'battery_2_bar', web: 'battery_2_bar' };
      default:
        return { ios: 'heart.text.square', android: 'health_and_safety', web: 'health_and_safety' };
    }
  }