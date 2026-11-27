import { PAYMENT_CONFIRM_REASON_MIN, PAYMENT_REASON_MAX, PAYMENT_REASON_MIN } from '@markaz/contracts/subscription-payments';
import {
  askFirst,
  Button,
  Card,
  EmptyState,
  ErrorState,
  formatDateTime,
  formatRupees,
  LoadingState,
  Notice,
  Row,
  ScrollScreen,
  TextField,
  uiStyles,
  useIsOnline,
  type Confirm,
} from '@markaz/mobile-kit';
import { errorText, NetworkError } from '@markaz/mobile-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { confirmPayment, rejectPayment } from '../api';
import { can } from '../access';
import { METHOD_LABELS } from '../labels';
import { adminKey, useAdminLevel, useServices, useUserId } from '../services';
import { OFFLINE_PAYMENTS, usePendingPayments } from './payments';

/** No answer to a decision: it may or may not have happened. Nothing is retried or queued. */
const UNKNOWN = 'No answer from the server. Nothing was queued. Check the list before trying again: the decision may or may not have been made.';

export function PaymentDetailScreen({ paymentId, confirm = askFirst, openLink = (url: string) => void Linking.openURL(url) }: { paymentId: string; confirm?: Confirm; openLink?: (url: string) => void }) {
  const { runtime } = useServices();
  const userId = useUserId();
  const level = useAdminLevel();
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const payments = usePendingPayments();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (done) return <ScrollScreen><Notice text={done} /></ScrollScreen>;
  if (!online) return <ScrollScreen><Notice text={OFFLINE_PAYMENTS} /></ScrollScreen>;
  if (!payments.data) return payments.error ? <ErrorState message={errorText(payments.error)} onRetry={() => void payments.refetch()} /> : <LoadingState />;

  const payment = payments.data.docs.find((entry) => entry.id === paymentId);
  if (!payment) {
    return (
      <ScrollScreen refreshing={payments.isRefetching} onRefresh={() => void payments.refetch()}>
        {problem ? <Notice tone="danger" text={problem} /> : null}
        <EmptyState title="Not waiting any more" text="This payment has been decided, or was never claimed. The console shows its history." />
      </ScrollScreen>
    );
  }

  const decide = (action: 'confirm' | 'reject') => {
    const text = reason.trim();
    const minimum = action === 'confirm' ? PAYMENT_CONFIRM_REASON_MIN : PAYMENT_REASON_MIN;
    if (text.length < minimum) {
      setProblem(`Write a reason of at least ${minimum} characters.`);
      return;
    }
    setProblem(null);
    const money = formatRupees(payment.amountRs);
    confirm(
      action === 'confirm' ? 'Confirm this payment?' : 'Reject this payment?',
      action === 'confirm' ? `${money} from ${payment.seller.name}: their plan becomes active.` : `${money} from ${payment.seller.name}: they are told it was rejected.`,
      action === 'confirm' ? 'Confirm payment' : 'Reject payment',
      () => {
        setBusy(true);
        const run = action === 'confirm' ? confirmPayment(runtime.client, payment.id, payment.amountRs, text) : rejectPayment(runtime.client, payment.id, text);
        void run
          .then(() => setDone(action === 'confirm' ? `Payment of ${money} confirmed.` : `Payment of ${money} rejected.`))
          .catch((error: unknown) => setProblem(error instanceof NetworkError ? UNKNOWN : errorText(error)))
          .finally(() => {
            setBusy(false);
            // The list is read again whatever happened: a refusal (409) means it changed.
            void queryClient.invalidateQueries({ queryKey: adminKey(userId, 'payments') });
          });
      },
    );
  };

  const proof = payment.proofUrl && payment.proofUrl.startsWith('https://') ? payment.proofUrl : null;
  return (
    <ScrollScreen refreshing={payments.isRefetching} onRefresh={() => void payments.refetch()}>
      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {formatRupees(payment.amountRs)}
        </Text>
        <Row label="Seller" value={payment.seller.name} />
        <Row label="Email" value={payment.seller.email} />
        <Row label="Plan" value={payment.planName} />
        <Row label="Method" value={payment.method ? METHOD_LABELS[payment.method]! : '-'} />
        <Row label="Reference" value={payment.reference ?? '-'} />
        <Row label="Claimed" value={formatDateTime(payment.claimedAt)} />
        {proof ? <Button title="Open the payment proof" kind="secondary" onPress={() => openLink(proof)} /> : null}
      </Card>
      {problem ? <Notice tone="danger" text={problem} /> : null}
      {can(level, 'payments.decide') ? (
        <Card title="Decision">
          <TextField label="Reason (kept in the audit log)" value={reason} onChangeText={setReason} multiline maxLength={PAYMENT_REASON_MAX} />
          <Button title="Confirm payment" onPress={() => decide('confirm')} busy={busy} />
          <Button title="Reject payment" kind="danger" onPress={() => decide('reject')} busy={busy} />
          <Text style={uiStyles.muted}>Check that the money is in your account before confirming.</Text>
        </Card>
      ) : (
        <Notice text="Your level can view payments, not decide them." />
      )}
    </ScrollScreen>
  );
}
