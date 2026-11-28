import { mobileLoginRequestSchema } from '@markaz/contracts/mobile';
import { AppText, BrandMark, Button, Card, Notice, ScrollScreen, TextField, type SessionEndReason } from '@markaz/mobile-kit';
import { ApiError, errorText } from '@markaz/mobile-kit/core';
import { useState } from 'react';
import { useServices } from '../services';

const ENDED: Partial<Record<SessionEndReason, string>> = {
  revoked: 'This phone was signed out. Sign in again.',
  suspended: 'This account is suspended. Contact Markazify support.',
};

export function signInProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const minutes = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null;
    return minutes ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'Too many attempts. Try again later.';
  }
  return errorText(error);
}

export function SignInScreen({ endedBecause }: { endedBecause?: SessionEndReason | null }) {
  const { runtime, appVersion, deviceName } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function signIn() {
    setProblem(null);
    setBusy(true);
    try {
      const body = { email, password, deviceName, platform: 'android' as const, appVersion, installationId: await runtime.installationId() };
      const checked = mobileLoginRequestSchema.safeParse(body);
      if (!checked.success) {
        setProblem(checked.error.issues[0]?.path[0] === 'password' ? 'Enter your password.' : 'Enter a valid email address.');
        return;
      }
      await runtime.session.signIn(checked.data);
    } catch (error) {
      setProblem(signInProblem(error));
    } finally {
      setBusy(false);
    }
  }

  const notice = endedBecause ? ENDED[endedBecause] : undefined;
  return (
    <ScrollScreen>
      <BrandMark tagline="Seller" />
      <Card>
        <AppText accessibilityRole="header" variant="title">
          Sign in to your shop
        </AppText>
        <AppText tone="muted">Use the email and password of your Markazify seller account.</AppText>
        {notice ? <Notice text={notice} /> : null}
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          revealable
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={signIn}
        />
        {problem ? <Notice tone="danger" text={problem} /> : null}
        <Button title="Sign in" onPress={signIn} busy={busy} />
      </Card>
      <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
        New sellers and forgotten passwords are handled on the website.
      </AppText>
    </ScrollScreen>
  );
}
