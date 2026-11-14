import http from "node:http";
import { SOCKET_ADDRESS_HEADER, isSocketStampActive, markSocketStampActive } from "./client-ip";

/**
 * Next.js route handlers can see headers but not the connection, and it only fills x-forwarded-for from the socket when
 * the client did not send one. So the address is written onto each request as it arrives, before Next.js sees it,
 * replacing anything a client sent under the same name. Called once, from instrumentation.ts. Node only.
 */
export function stampSocketAddresses(): void {
  if (isSocketStampActive()) return;
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function stampedEmit(this: http.Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage;
      request.headers[SOCKET_ADDRESS_HEADER] = request.socket.remoteAddress ?? "";
    }
    return Reflect.apply(emit, this, [event, ...args]) as boolean;
  } as typeof http.Server.prototype.emit;
  markSocketStampActive();
}
