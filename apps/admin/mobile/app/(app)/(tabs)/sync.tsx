import { Gate } from '../../../src/components/gate';
import { SyncScreen } from '../../../src/screens/sync';

export default function Page() {
  return (
    <Gate screen="sync">
      <SyncScreen />
    </Gate>
  );
}
