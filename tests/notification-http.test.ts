import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  notificationErrorMessage,
  postNotification,
} from '../src/lib/notifications/http'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notification transport', () => {
  it('uses an abort signal to bound a request that never responds', async () => {
    const controller = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(controller.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            )
          }),
      ),
    )
    const request = postNotification('https://example.test/secret', {
      method: 'POST',
    })
    const rejected = expect(request).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    await rejected
    expect(timeout).toHaveBeenCalledWith(15_000)
  })

  it('reports the HTTP status without exposing the URL or response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private token', { status: 403 })),
    )
    let message = ''
    try {
      await postNotification('https://example.test/secret-token', {
        method: 'POST',
      })
    } catch (error) {
      message = notificationErrorMessage(error)
    }
    expect(message).toBe('Notifikační služba vrátila HTTP 403.')
  })

  it('redacts arbitrary network errors and explains timeouts', () => {
    expect(
      notificationErrorMessage(new Error('fetch https://host/secret failed')),
    ).not.toContain('secret')
    expect(
      notificationErrorMessage(
        new DOMException('internal detail', 'TimeoutError'),
      ),
    ).toContain('15 sekund')
  })
})
