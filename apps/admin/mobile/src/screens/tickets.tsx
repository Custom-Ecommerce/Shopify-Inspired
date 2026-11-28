import { TICKET_STATUSES } from '@markaz/contracts/support';
import {
  Chip,
  formatDateTime,
  LifeBuoy,
  PagedList,
  type Tone,
  usePagedList,
  Wrap,
} from '@markaz/mobile-kit';
import { useCallback, useState } from 'react';
import { fetchTickets, type TicketRow } from '../api';
import { ListRow } from '../components/row';
import { label } from '../labels';
import { adminKey, useServices, useUserId } from '../services';

const TICKET_TONES: Record<string, Tone> = { open: 'warning', answered: 'info', closed: 'neutral' };

export function TicketsScreen({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const { runtime } = useServices();
  const userId = useUserId();
  const [status, setStatus] = useState<string | undefined>('open');
  const paged = usePagedList(adminKey(userId, 'tickets', status ?? 'all'), (page) => fetchTickets(runtime.client, status, page), userId !== '');

  const renderItem = useCallback(
    ({ item }: { item: TicketRow }) => (
      <ListRow
        id={item.id}
        title={item.subject}
        lines={[
          `${item.sellerName ?? 'Unknown seller'} · ${label(item.status)}`,
          `${item.messageCount} ${item.messageCount === 1 ? 'message' : 'messages'}, last ${item.lastFrom === 'admin' ? 'from us' : 'from the seller'} ${formatDateTime(item.lastMessageAt)}`,
        ]}
        badge={{ label: label(item.status), tone: TICKET_TONES[item.status] ?? 'neutral' }}
        onOpen={onOpenTicket}
      />
    ),
    [onOpenTicket],
  );

  return (
    <PagedList
      paged={paged}
      renderItem={renderItem}
      empty={{ icon: LifeBuoy, title: 'No tickets here' }}
      header={
        <Wrap>
          {TICKET_STATUSES.map((value) => (
            <Chip key={value} label={label(value)} selected={status === value} onPress={() => setStatus(value)} />
          ))}
          <Chip label="All" selected={!status} onPress={() => setStatus(undefined)} />
        </Wrap>
      }
    />
  );
}
