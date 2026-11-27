import { useRouter } from 'expo-router';
import { StoresScreen } from '../../src/screens/stores';

export default function Stores() {
  const router = useRouter();
  return <StoresScreen onDone={() => router.back()} />;
}
