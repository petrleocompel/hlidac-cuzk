import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// --- Better Auth ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
})

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/** Better Auth SSO plugin table (+ optional app-owned `name` label). */
export const ssoProvider = pgTable(
  'sso_provider',
  {
    id: text('id').primaryKey(),
    issuer: text('issuer').notNull(),
    oidcConfig: text('oidc_config'),
    samlConfig: text('saml_config'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull().unique(),
    organizationId: text('organization_id'),
    domain: text('domain').notNull(),
    /** Display label for login buttons; ignored by Better Auth. */
    name: text('name'),
  },
  (table) => [index('sso_provider_providerId_idx').on(table.providerId)],
)

// --- Domain ---

export const userNotificationSettings = pgTable('user_notification_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  gotifyUrl: text('gotify_url'),
  gotifyToken: text('gotify_token'),
  gotifyPriority: integer('gotify_priority').default(5),
  slackWebhookUrl: text('slack_webhook_url'),
  discordWebhookUrl: text('discord_webhook_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const parcelWatches = pgTable(
  'parcel_watches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kuCode: text('ku_code').notNull(),
    kuName: text('ku_name').notNull(),
    parcelNumber: integer('parcel_number').notNull(),
    parcelSubdivision: integer('parcel_subdivision'),
    druhCislovani: integer('druh_cislovani').notNull().default(2),
    isknId: text('iskn_id').notNull(),
    pollIntervalMinutes: integer('poll_interval_minutes')
      .notNull()
      .default(1440),
    enabled: boolean('enabled').notNull().default(true),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSnapshotJson: jsonb('last_snapshot_json'),
    lastError: text('last_error'),
    pollClaimToken: uuid('poll_claim_token'),
    pollLockedUntil: timestamp('poll_locked_until', { withTimezone: true }),
    manualRefreshAfter: timestamp('manual_refresh_after', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index('parcel_watches_userId_idx').on(table.userId),
    index('parcel_watches_enabled_idx').on(table.enabled),
  ],
)

export const watchEvents = pgTable(
  'watch_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => parcelWatches.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // new_rizeni | error
    payloadJson: jsonb('payload_json'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('watch_events_watchId_idx').on(table.watchId)],
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => watchEvents.id, { onDelete: 'cascade' }),
    channel: text('channel', {
      enum: ['gotify', 'slack', 'discord'],
    }).notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'sent', 'failed'],
    })
      .notNull()
      .default('pending'),
    // Persist the message, but resolve credentials from current settings at send time.
    title: text('title').notNull(),
    message: text('message').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    claimToken: uuid('claim_token'),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_event_channel_idx').on(
      table.eventId,
      table.channel,
    ),
    index('notification_deliveries_due_idx').on(
      table.status,
      table.nextAttemptAt,
    ),
    index('notification_deliveries_lease_idx').on(
      table.status,
      table.lockedUntil,
    ),
  ],
)

// Shared by app, CLI and workers; never store the API key itself.
export const cuzkApiControl = pgTable('cuzk_api_control', {
  id: text('id').primaryKey(),
  keyFingerprint: text('key_fingerprint').notNull(),
  nextRequestAt: timestamp('next_request_at', { withTimezone: true }),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  blockedReason: text('blocked_reason'),
  accountJson: jsonb('account_json'),
  accountDay: date('account_day', { mode: 'string' }),
  accountBaseline: integer('account_baseline'),
  accountCheckedAt: timestamp('account_checked_at', { withTimezone: true }),
  accountAttemptAt: timestamp('account_attempt_at', { withTimezone: true }),
  accountError: text('account_error'),
})

export const cuzkApiDailyUsage = pgTable('cuzk_api_daily_usage', {
  day: date('day', { mode: 'string' }).primaryKey(),
  reserved: integer('reserved').notNull().default(0),
})

export const cuzkApiRequests = pgTable(
  'cuzk_api_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    day: date('day', { mode: 'string' }).notNull(),
    endpoint: text('endpoint').notNull(),
    attempt: integer('attempt').notNull(),
    outcome: text('outcome', {
      enum: [
        'pending',
        'success',
        'http_error',
        'timeout',
        'network_error',
        'invalid_response',
        'cancelled',
      ],
    })
      .notNull()
      .default('pending'),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [index('cuzk_api_requests_day_idx').on(table.day)],
)

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  watches: many(parcelWatches),
  notificationSettings: one(userNotificationSettings, {
    fields: [user.id],
    references: [userNotificationSettings.userId],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const parcelWatchesRelations = relations(
  parcelWatches,
  ({ one, many }) => ({
    user: one(user, {
      fields: [parcelWatches.userId],
      references: [user.id],
    }),
    events: many(watchEvents),
  }),
)

export const watchEventsRelations = relations(watchEvents, ({ one, many }) => ({
  watch: one(parcelWatches, {
    fields: [watchEvents.watchId],
    references: [parcelWatches.id],
  }),
  deliveries: many(notificationDeliveries),
}))

export const notificationDeliveriesRelations = relations(
  notificationDeliveries,
  ({ one }) => ({
    event: one(watchEvents, {
      fields: [notificationDeliveries.eventId],
      references: [watchEvents.id],
    }),
  }),
)

export type ParcelWatch = typeof parcelWatches.$inferSelect
export type WatchEvent = typeof watchEvents.$inferSelect
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
export type UserNotificationSettings =
  typeof userNotificationSettings.$inferSelect
