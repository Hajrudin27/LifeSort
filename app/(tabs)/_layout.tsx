import { type Href, Link, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import FloatingTabBar from '@/components/FloatingTabBar';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useModuleEnabled } from '@/core/modules/useModuleEnabled';
import { useProfileStore } from '@/store/useProfileStore';

type IconName = { ios: string; android: string; web: string };

type HeaderIconLinkProps = {
  href: Href;
  icon: IconName;
  label: string;
  side: 'left' | 'right';
  tintColor: string;
  backgroundColor: string;
  borderColor: string;
};

function HeaderIconLink({ href, icon, label, side, tintColor, backgroundColor, borderColor }: HeaderIconLinkProps) {
  const buttonStyle = StyleSheet.flatten([
    styles.headerIconButton,
    side === 'left' ? styles.headerIconLeft : styles.headerIconRight,
    { backgroundColor, borderColor },
  ]);

  return (
    <Link href={href} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={buttonStyle}>
        {({ pressed }) => (
          <SymbolView
            name={icon as any}
            size={20}
            tintColor={tintColor}
            style={{ opacity: pressed ? 0.5 : 1 }}
          />
        )}
      </Pressable>
    </Link>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const theme = Colors[colorScheme];
  const gender = useProfileStore((s) => s.profile.gender);

  // Brugerens eget valg af moduler (APP-010). Et fravalgt modul forsvinder fra
  // navigationen — men ruten virker stadig, og dataene bliver liggende. Det er
  // forskellen på et fravalg og en kill switch.
  const economyEnabled = useModuleEnabled('economy');
  const cycleEnabled = useModuleEnabled('cycle');

  // Køns-gaten er stadig APP-071's at fjerne; her lægges brugerens valg oveni.
  const showCycleTab = gender === 'female' && cycleEnabled;
  const navBorder = 'rgba(253,246,237,0.1)';
  const headerButtonBackground = colorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(22,19,15,0.05)';

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        sceneStyle: { backgroundColor: theme.background },
        tabBarHideOnKeyboard: true,
        headerStyle: {
          backgroundColor: theme.background,
        },
        headerTitleStyle: styles.headerTitle,
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('home.title'),
          headerLeft: () => (
            <HeaderIconLink
              href="/search"
              icon={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
              label={t('common.a11y.search')}
              side="left"
              tintColor={theme.text}
              backgroundColor={headerButtonBackground}
              borderColor={navBorder}
            />
          ),
          headerRight: () => (
            <HeaderIconLink
              href="/modal"
              icon={{ ios: 'info.circle', android: 'info', web: 'info' }}
              label={t('common.a11y.info')}
              side="right"
              tintColor={theme.text}
              backgroundColor={headerButtonBackground}
              borderColor={navBorder}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="economy"
        options={{
          title: t('economy.title'),
          href: economyEnabled ? undefined : null,
          headerRight: () => (
            <HeaderIconLink
              href="/economy/insights"
              icon={{ ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' }}
              label={t('economy.insightsTitle')}
              side="right"
              tintColor={theme.text}
              backgroundColor={headerButtonBackground}
              borderColor={navBorder}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="life"
        options={{
          title: t('life.title'),
        }}
      />
      <Tabs.Screen
        name="cycle"
        options={{
          title: t('cycle.title'),
          href: showCycleTab ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('settings.title'),
          tabBarLabel: t('settings.tabLabel'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  headerIconButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerIconLeft: {
    marginLeft: 16,
  },
  headerIconRight: {
    marginRight: 16,
  },
});
