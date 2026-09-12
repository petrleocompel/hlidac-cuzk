import { createServer } from 'node:http'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  notificationErrorMessage,
  postNotification,
} from '../src/lib/notifications/http'
import {
  isPublicNotificationAddress,
  validateNotificationDestination,
} from '../src/lib/notifications/destinations'

const dnsLookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dnsLookup }))
const policy = vi.hoisted(() => ({
  gotifyEnabled: true,
  slackEnabled: true,
  discordEnabled: true,
  gotifyAllowedUrls: [] as string[],
}))
vi.mock('../src/lib/notifications/policy', () => ({
  readNotificationPolicy: async () => policy,
}))
let base: string
let status = 200
const paths: string[] = []
const server = createServer((req, res) => {
  paths.push(req.url ?? '')
  if (req.url === '/timeout/message') return
  res.statusCode = status
  res.setHeader('Location', base + '/redirected')
  res.end('secret-response-body')
})
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('port')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
afterEach(() => {
  vi.restoreAllMocks()
  dnsLookup.mockReset()
  policy.gotifyAllowedUrls = []
  policy.gotifyEnabled = true
  status = 200
  paths.length = 0
})
const payload = {
  headers: {
    'Content-Type': 'application/json',
    'X-Gotify-Key': 'fixture-token',
  },
  body: '{}',
}

describe('notification destinations and pinned transport', () => {
  it('allows LAN with an empty whitelist, exact entries and path prefixes', async () => {
    await postNotification(base, payload, 'gotify')
    policy.gotifyAllowedUrls = [base + '/gotify/']
    await postNotification(base + '/gotify', payload, 'gotify')
    await expect(postNotification(base, payload, 'gotify')).rejects.toThrow(
      'Nepovolený',
    )
    expect(paths).toEqual(['/message', '/gotify/message'])
  })
  it('enforces the administrator channel switch even with an empty whitelist', async () => {
    policy.gotifyEnabled = false
    await expect(postNotification(base, payload, 'gotify')).rejects.toThrow(
      'správce vypnul',
    )
    expect(paths).toHaveLength(0)
  })
  it('rejects redirects and redacts error responses', async () => {
    status = 302
    await expect(postNotification(base, payload, 'gotify')).rejects.toThrow(
      'HTTP 302',
    )
    expect(paths).toEqual(['/message'])
    status = 403
    await expect(postNotification(base, payload, 'gotify')).rejects.toThrow(
      'HTTP 403',
    )
    expect(
      notificationErrorMessage(new Error('https://host/secret')),
    ).not.toContain('secret')
  })
  it('bounds a server that never answers', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(40))
    await expect(
      postNotification(base + '/timeout', payload, 'gotify'),
    ).rejects.toThrow('15 sekund')
  })
  it('pins the resolved address instead of resolving the hostname again', async () => {
    const lookup = dnsLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
    ])
    const destination = base.replace('127.0.0.1', 'gotify.invalid')
    await postNotification(destination, payload, 'gotify')
    expect(paths).toEqual(['/message'])
    expect(lookup).toHaveBeenCalledTimes(1)
  })
  it('rejects a private address in any public webhook DNS answer before connecting', async () => {
    dnsLookup.mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(
      postNotification(
        'https://hooks.slack.com/services/TTEST/BTEST/fixture',
        payload,
        'slack',
      ),
    ).rejects.toThrow('DNS')
    expect(paths).toHaveLength(0)
  })
  it('rejects non-provider hosts, unsafe schemes, credentials and URL tricks', () => {
    for (const url of [
      base,
      'https://hooks.slack.com.evil.test/services/T1/B1/token',
      'http://hooks.slack.com/services/T1/B1/token',
      'https://user:password@hooks.slack.com/services/T1/B1/token',
      'https://hooks.slack.com:444/services/T1/B1/token',
      'https://hooks.slack.com/services/T1/B1/token?secret=x',
      'https://hooks.slack.com/services/T1/B1/token#x',
      'https://hooks.slack.com/services/T1/B1/%2f',
    ]) {
      expect(() =>
        validateNotificationDestination(url, 'slack', policy),
      ).toThrow()
    }
    expect(
      validateNotificationDestination(
        'https://hooks.slack-gov.com/services/T1/B1/token',
        'slack',
        policy,
      ).hostname,
    ).toBe('hooks.slack-gov.com')
    expect(
      validateNotificationDestination(
        'https://discord.com/api/webhooks/123/token',
        'discord',
        policy,
      ).hostname,
    ).toBe('discord.com')
  })
  it('rejects private, mapped and reserved IP ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.1.1',
      '192.168.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '224.1.1.1',
      '0.0.0.0',
      '::1',
      '::ffff:8.8.8.8',
      'fe80::1',
      'fd00::1',
      '64:ff9b::1',
      '2001:db8::1',
      '2001:0db8:0000:0000:0000:0000:0000:0001',
      '2002:7f00:1::',
    ])
      expect(isPublicNotificationAddress(ip), ip).toBe(false)
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])
      expect(isPublicNotificationAddress(ip), ip).toBe(true)
  })
})
