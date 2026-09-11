/** Bounded requests; errors deliberately exclude response bodies and secret URLs. */
export class NotificationHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Notifikační služba vrátila HTTP ${status}.`)
  }
}

export async function postNotification(
  url: string | URL,
  init: RequestInit,
): Promise<void> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  })
  await response.body?.cancel()
  if (!response.ok) throw new NotificationHttpError(response.status)
}

export function notificationErrorMessage(error: unknown): string {
  if (error instanceof NotificationHttpError) return error.message
  if (
    error instanceof Error &&
    ['TimeoutError', 'AbortError'].includes(error.name)
  ) {
    return 'Notifikační služba neodpověděla do 15 sekund.'
  }
  return 'Doručení selhalo. Ověřte nastavení kanálu a dostupnost služby.'
}
