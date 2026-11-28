import { useSessionState, useTheme } from '@markaz/mobile-kit';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignInScreen } from '../src/screens/sign-in';
import { useServices } from '../src/services';

export default function SignIn() {
  const session = useSessionState(useServices().runtime);
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SignInScreen endedBecause={session.endedBecause} />
    </SafeAreaView>
  );
}
