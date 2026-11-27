import { ErrorState } from '@markaz/mobile-kit';
import { useLocalSearchParams } from 'expo-router';
import { Gate } from '../../../src/components/gate';
import { PaymentDetailScreen } from '../../../src/screens/payment-detail';

export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // The id comes from a link or a notification: anything but a record id opens nothing.
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) return <ErrorState message="This cannot be opened." />;
  return (
    <Gate screen="payments">
      <PaymentDetailScreen key={id} paymentId={id} />
    </Gate>
  );
}
