import { useRouter, type Href } from 'expo-router';
import { Gate } from '../../../src/components/gate';
import { PaymentsScreen } from '../../../src/screens/payments';

export default function Payments() {
  const router = useRouter();
  return (
    <Gate screen="payments">
      <PaymentsScreen onOpenPayment={(id) => router.push(`/payments/${id}` as Href)} />
    </Gate>
  );
}
