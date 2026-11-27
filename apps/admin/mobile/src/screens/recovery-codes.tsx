import { Button, Card, Notice, ScrollScreen, uiStyles } from '@markaz/mobile-kit';
import { Text } from 'react-native';

/** Shown once, right after the authenticator is set up. The codes are not saved on the phone. */
export function RecoveryCodesScreen({ codes, onSaved }: { codes: readonly string[]; onSaved: () => void }) {
  return (
    <ScrollScreen>
      <Text accessibilityRole="header" style={uiStyles.title}>
        Save your recovery codes
      </Text>
      <Notice text="Each code works once, if you lose your authenticator. They are shown only now: write them down and keep them away from this phone." />
      <Card>
        {codes.map((code) => (
          <Text key={code} selectable style={uiStyles.title}>
            {code}
          </Text>
        ))}
      </Card>
      <Button title="I have saved them" onPress={onSaved} />
    </ScrollScreen>
  );
}
