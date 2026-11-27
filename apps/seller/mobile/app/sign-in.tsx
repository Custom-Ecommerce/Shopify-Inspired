import { useSessionState } from '@markaz/mobile-kit';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignInScreen } from '../src/screens/sign-in';
import { useServices } from '../src/services';

export default function SignIn() {
  const { runtime } = useServices();
  const session = useSessionState(runtime);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <SignInScreen endedBecause={session.endedBecause} />
    </SafeAreaView>
  );
}
