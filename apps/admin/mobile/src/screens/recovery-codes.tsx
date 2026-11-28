import { AppText, Button, Card, KeyRound, Notice, ScrollScreen } from '@markaz/mobile-kit';

/** Shown once, right after the authenticator is set up. The codes are not saved on the phone. */
export function RecoveryCodesScreen({ codes, onSaved }: { codes: readonly string[]; onSaved: () => void }) {
  return (
    <ScrollScreen>
      <AppText accessibilityRole="header" variant="title">
        Save your recovery codes
      </AppText>
      <Notice text="Each code works once, if you lose your authenticator. They are shown only now: write them down and keep them away from this phone." />
      <Card title="Recovery codes" icon={KeyRound}>
        {codes.map((code) => (
          <AppText key={code} selectable variant="heading" style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
            {code}
          </AppText>
        ))}
      </Card>
      <Button title="I have saved them" onPress={onSaved} />
    </ScrollScreen>
  );
}
