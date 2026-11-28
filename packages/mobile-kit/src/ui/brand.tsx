import { View } from 'react-native';
import { AppText } from './primitives';
import { makeStyles } from './theme-provider';

/** The web's BrandMark: the "M" on a primary tile and the Markazify wordmark. `tagline` names the app under it. */
export function BrandMark({ tagline }: { tagline?: string }) {
  const styles = useStyles();
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={tagline ? `Markazify ${tagline}` : 'Markazify'} style={styles.row}>
      <View style={styles.tile}>
        <AppText variant="title" weight="semibold" tone="onPrimary">
          M
        </AppText>
      </View>
      <View>
        <AppText variant="title" weight="semibold">
          Markazify
        </AppText>
        {tagline ? (
          <AppText variant="caption" tone="muted">
            {tagline}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
  tile: { width: 44, height: 44, borderRadius: t.radius.xl, backgroundColor: t.colors.primary, alignItems: 'center', justifyContent: 'center' },
}));
