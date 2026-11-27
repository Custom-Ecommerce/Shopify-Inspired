import { MOBILE_TOTP_CODES, mobileAdminLoginRequestSchema, mobileTotpEnrolmentSchema, type MobileTotpEnrolment } from '@markaz/contracts/mobile';
import { Button, Card, Notice, ScrollScreen, TextField, uiStyles, type SessionEndReason } from '@markaz/mobile-kit';
import { ApiError, errorText, type SignInAnswer } from '@markaz/mobile-kit/core';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { useServices } from '../services';

const ENDED: Partial<Record<SessionEndReason, string>> = {
  revoked: 'This phone was signed out. Sign in again.',
  suspended: 'This account is disabled.',
};

type Step = 'password' | 'code' | 'recovery';

export function signInProblem(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const minutes = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null;
    return minutes ? `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'Too many attempts. Try again later.';
  }
  return errorText(error);
}

/** Password first, then the code of the authenticator app (or one recovery code). A first sign-in sets the authenticator up. */
export function SignInScreen({ endedBecause, openLink = (url: string) => Linking.openURL(url) }: { endedBecause?: SessionEndReason | null; openLink?: (url: string) => Promise<unknown> }) {
  const { runtime, appVersion, deviceName, recovery } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [enrolment, setEnrolment] = useState<MobileTotpEnrolment | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setProblem(null);
    setBusy(true);
    try {
      const body = {
        email,
        password,
        deviceName,
        platform: 'android' as const,
        appVersion,
        installationId: await runtime.installationId(),
        ...(step === 'code' ? { totp: code.replace(/\s/g, '') } : {}),
        ...(step === 'recovery' ? { recoveryCode: code.trim() } : {}),
      };
      const checked = mobileAdminLoginRequestSchema.safeParse(body);
      if (!checked.success) {
        const field = checked.error.issues[0]?.path[0];
        setProblem(
          field === 'password'
            ? 'Enter your password.'
            : field === 'totp'
              ? 'Enter the 6 digit code.'
              : field === 'recoveryCode'
                ? 'Enter one recovery code.'
                : 'Enter a valid email address.',
        );
        return;
      }
      const answer = await runtime.session.signIn<SignInAnswer & { recoveryCodes?: string[] }>(checked.data);
      if (answer.recoveryCodes?.length) recovery.set(answer.recoveryCodes);
    } catch (error) {
      if (error instanceof ApiError && error.code === MOBILE_TOTP_CODES.ENROLMENT_REQUIRED) {
        const parsed = mobileTotpEnrolmentSchema.safeParse((error.body as { enrolment?: unknown } | null)?.enrolment);
        if (parsed.success) {
          setEnrolment(parsed.data);
          setStep('code');
          setCode('');
          return;
        }
      }
      if (error instanceof ApiError && error.code === MOBILE_TOTP_CODES.REQUIRED) {
        setStep('code');
        setCode('');
        return;
      }
      setProblem(signInProblem(error));
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    setStep('password');
    setEnrolment(null);
    setCode('');
    setProblem(null);
  };

  const notice = endedBecause ? ENDED[endedBecause] : undefined;
  return (
    <ScrollScreen>
      <Text accessibilityRole="header" style={uiStyles.title}>
        Markazify admin
      </Text>
      {notice && step === 'password' ? <Notice text={notice} /> : null}

      {step === 'password' ? (
        <>
          <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" onSubmitEditing={() => void submit()} />
        </>
      ) : null}

      {enrolment && step !== 'password' ? (
        <Card title="Set up your authenticator">
          <Text style={uiStyles.body}>Add this account to an authenticator app, then type the code it shows. The key is shown only now.</Text>
          <Text selectable accessibilityLabel="Authenticator key" style={uiStyles.title}>
            {enrolment.secret}
          </Text>
          <Button
            title="Open the authenticator app"
            kind="secondary"
            onPress={() => void openLink(enrolment.otpauthUri).catch(() => setProblem('No authenticator app opened. Type the key into it by hand.'))}
          />
        </Card>
      ) : null}

      {step !== 'password' ? (
        <TextField
          label={step === 'code' ? '6 digit code' : 'Recovery code'}
          value={code}
          onChangeText={setCode}
          keyboardType={step === 'code' ? 'number-pad' : 'default'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={step === 'code' ? 'one-time-code' : 'off'}
          onSubmitEditing={() => void submit()}
        />
      ) : null}

      {problem ? <Notice tone="danger" text={problem} /> : null}
      <Button title={step === 'password' ? 'Continue' : 'Sign in'} onPress={() => void submit()} busy={busy} />
      {step !== 'password' ? (
        <>
          {!enrolment ? (
            <Button
              title={step === 'code' ? 'Use a recovery code' : 'Use the authenticator code'}
              kind="secondary"
              onPress={() => {
                setStep(step === 'code' ? 'recovery' : 'code');
                setCode('');
                setProblem(null);
              }}
            />
          ) : null}
          <Button title="Back" kind="secondary" onPress={back} />
        </>
      ) : null}
    </ScrollScreen>
  );
}
