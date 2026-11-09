/** Runs once when the server starts. Makes each connection's address readable by the rate limiter. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { stampSocketAddresses } = await import('@markaz/platform-kit/socket-address');
    stampSocketAddresses();
  }
}
