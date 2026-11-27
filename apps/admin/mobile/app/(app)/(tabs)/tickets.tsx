import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Gate } from '../../../src/components/gate';
import { TicketsScreen } from '../../../src/screens/tickets';

export default function Tickets() {
  const router = useRouter();
  const open = useCallback((id: string) => router.push(`/tickets/${id}` as Href), [router]);
  return (
    <Gate screen="tickets">
      <TicketsScreen onOpenTicket={open} />
    </Gate>
  );
}
