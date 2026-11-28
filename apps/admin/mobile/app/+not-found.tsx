import { Redirect } from 'expo-router';

/** A link to anything the app does not have opens the start screen, not a list of what it has. */
export default function NotFound() {
  return <Redirect href="/" />;
}
