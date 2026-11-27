import { Button } from '@markaz/mobile-kit';
import { usePending } from '../offline';

/** Says that changes are waiting (or need a decision) and opens them. Nothing when the queue is empty. */
export function QueueNotice({ onOpen }: { onOpen: () => void }) {
  const changes = usePending();
  if (changes.length === 0) return null;
  const decide = changes.some((change) => change.state !== 'pending');
  const count = `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} waiting to be sent`;
  return <Button title={decide ? `${count}: your decision is needed` : count} kind={decide ? 'danger' : 'secondary'} onPress={onOpen} />;
}
