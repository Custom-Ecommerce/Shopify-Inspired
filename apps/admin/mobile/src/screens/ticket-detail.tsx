import { TICKET_STATUSES, TICKET_TEXT_MAX } from '@markaz/contracts/support';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  formatDateTime,
  LoadingState,
  Notice,
  Row,
  ScrollScreen,
  TextField,
  uiStyles,
  useIsOnline,
} from '@markaz/mobile-kit';
import { ApiError, errorText, NetworkError } from '@markaz/mobile-kit/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { fetchTicket, replyTicket, setTicketStatus } from '../api';
import { can } from '../access';
import { label } from '../labels';
import { adminKey, useAdminLevel, useServices, useUserId } from '../services';

/** Replying and changing the status happen now or not at all. */
export function TicketDetailScreen({ ticketId }: { ticketId: string }) {
  const { runtime } = useServices();
  const userId = useUserId();
  const level = useAdminLevel();
  const online = useIsOnline();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: adminKey(userId, 'ticket', ticketId), queryFn: () => fetchTicket(runtime.client, ticketId), enabled: userId !== '' });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ticket = detail.data;
  if (!ticket) {
    if (!online) return <ScrollScreen><Notice text="Tickets need a connection." /></ScrollScreen>;
    return detail.error ? <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} /> : <LoadingState rows={4} />;
  }

  /** One write: true when it was made. The ticket is read again either way (a 409 means it changed). */
  async function write(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    try {
      await run();
      return true;
    } catch (error) {
      if (error instanceof NetworkError) setProblem('No answer from the server. Check the ticket before sending again.');
      else if (error instanceof ApiError && error.status === 409) setProblem(`${error.message} The latest version is shown.`);
      else setProblem(errorText(error));
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: adminKey(userId, 'ticket', ticketId) });
      void queryClient.invalidateQueries({ queryKey: adminKey(userId, 'tickets') });
      setBusy(false);
    }
  }

  const send = async () => {
    const message = text.trim();
    if (!message) return;
    if (await write(() => replyTicket(runtime.client, ticketId, ticket.revision, message))) setText('');
  };

  const mayReply = can(level, 'tickets.reply');
  return (
    <ScrollScreen refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      {!online ? <Notice text="Offline. Replying and changing the status need a connection." /> : null}
      {online && detail.error ? <Notice text={errorText(detail.error)} /> : null}
      <Card>
        <Text accessibilityRole="header" style={uiStyles.title}>
          {ticket.subject}
        </Text>
        <Row label="Seller" value={ticket.sellerName ?? '-'} />
        {ticket.sellerEmail ? <Row label="Email" value={ticket.sellerEmail} /> : null}
        {ticket.orderRef ? <Row label="Order" value={ticket.orderRef} /> : null}
        <Row label="Status" value={label(ticket.status)} strong />
      </Card>
      <Card title="Messages">
        {ticket.messages.map((message, index) => (
          <View key={index}>
            <Text style={uiStyles.muted}>
              {message.from === 'admin' ? 'Markazify' : 'Seller'} · {formatDateTime(message.at)}
            </Text>
            <Text style={uiStyles.body}>{message.text}</Text>
          </View>
        ))}
      </Card>
      {problem ? <Notice tone="danger" text={problem} /> : null}
      {mayReply ? (
        <>
          {ticket.status !== 'closed' ? (
            <Card title="Reply">
              <TextField label="Your reply (the seller is emailed)" value={text} onChangeText={setText} multiline maxLength={TICKET_TEXT_MAX} />
              <Button title="Send reply" onPress={() => void send()} busy={busy} disabled={!online || !text.trim()} />
            </Card>
          ) : (
            <Notice text="This ticket is closed. Open it again to reply." />
          )}
          <Card title="Status">
            <View style={uiStyles.wrap}>
              {TICKET_STATUSES.map((status) => (
                <Chip
                  key={status}
                  label={`Set ${label(status).toLowerCase()}`}
                  selected={ticket.status === status}
                  onPress={() => {
                    if (ticket.status !== status && online && !busy) void write(() => setTicketStatus(runtime.client, ticketId, ticket.revision, status));
                  }}
                />
              ))}
            </View>
          </Card>
        </>
      ) : null}
    </ScrollScreen>
  );
}
