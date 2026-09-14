/** Executed inside a disposable Compose app container against the built HTTP app. */
import assert from 'node:assert/strict'
import postgres from 'postgres'
assert(new URL(process.env.DATABASE_URL).pathname.startsWith('/hlidac_test_'))
const client = postgres(process.env.DATABASE_URL, { max: 1 })
const base = 'http://127.0.0.1:3000'
const password = 'compose-fixture-member-password'
function cookies(response) {
  const jar = new Map()
  for (const raw of response.headers.getSetCookie()) {
    const pair = raw.split(';')[0]
    jar.set(pair.slice(0, pair.indexOf('=')), pair)
  }
  return [...jar.values()].join('; ')
}
function request(path, body, cookie = '') {
  return fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      Origin: process.env.BETTER_AUTH_URL || base,
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
let memberId, watchId
try {
  const denied = await request('/api/auth/sign-up/email', {
    name: 'Uninvited',
    email: 'uninvited@example.test',
    password,
  })
  assert(denied.status >= 400)
  const login = await request('/api/auth/sign-in/email', {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  })
  assert.equal(login.status, 200)
  const cookie = cookies(login)
  const created = await request(
    '/api/auth/admin/create-user',
    {
      name: 'Member fixture',
      email: 'member@example.test',
      password,
      role: 'user',
    },
    cookie,
  )
  assert.equal(created.status, 200)
  memberId = (await created.json()).user.id
  const [admin] =
    await client`select id from "user" where email = ${process.env.ADMIN_EMAIL}`
  const [watch] =
    await client`insert into parcel_watches(user_id, label, iskn_id, enabled) values (${admin.id}, 'PRIVATE-SMOKE-WATCH', '1', false) returning id`
  watchId = watch.id
  const own = await request('/dashboard/watches/' + watchId, undefined, cookie)
  assert.equal(own.status, 200)
  assert((await own.text()).includes('PRIVATE-SMOKE-WATCH'))
  const member = await request('/api/auth/sign-in/email', {
    email: 'member@example.test',
    password,
  })
  assert.equal(member.status, 200)
  const foreign = await request(
    '/dashboard/watches/' + watchId,
    undefined,
    cookies(member),
  )
  assert(foreign.status >= 400 || [302, 307].includes(foreign.status))
  assert(!(await foreign.text()).includes('PRIVATE-SMOKE-WATCH'))
  const audit = await request('/admin/audit', undefined, cookies(member))
  assert([302, 307].includes(audit.status))
  console.log(
    'PASS real HTTP login, private registration, foreign-watch and admin access rejection',
  )
} finally {
  if (watchId) await client`delete from parcel_watches where id = ${watchId}`
  if (memberId) await client`delete from "user" where id = ${memberId}`
  await client.end()
}
