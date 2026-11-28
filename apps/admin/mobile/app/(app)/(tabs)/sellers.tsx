import { Gate } from '../../../src/components/gate';
import { SellersScreen } from '../../../src/screens/sellers';

export default function Page() {
  return (
    <Gate screen="sellers">
      <SellersScreen />
    </Gate>
  );
}
