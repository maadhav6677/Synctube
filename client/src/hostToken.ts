const prefix = "watch-party:host-token:";

// Keep the host capability scoped to this browser session: it is needed to
// reconnect as host, but should not survive indefinitely on a shared device.
export function getHostToken(roomId: string): string | undefined {
  return sessionStorage.getItem(`${prefix}${roomId}`) ?? undefined;
}

export function saveHostToken(roomId: string, token: string): void {
  sessionStorage.setItem(`${prefix}${roomId}`, token);
}

export function clearHostToken(roomId: string): void {
  sessionStorage.removeItem(`${prefix}${roomId}`);
}
