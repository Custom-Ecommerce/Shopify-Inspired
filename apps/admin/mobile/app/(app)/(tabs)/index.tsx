import { Redirect, type Href } from 'expo-router';
import { tabsFor } from '../../../src/access';
import { Gate } from '../../../src/components/gate';
import { OverviewScreen } from '../../../src/screens/overview';
import { useAdminLevel } from '../../../src/services';

export default function Home() {
  const first = tabsFor(useAdminLevel())[0];
  // A level without the overview (customer support) starts on its own first tab.
  if (first && first !== 'overview') return <Redirect href={`/${first}` as Href} />;
  return (
    <Gate screen="overview">
      <OverviewScreen />
    </Gate>
  );
}
