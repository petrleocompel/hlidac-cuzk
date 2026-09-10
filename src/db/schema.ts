import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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
    pollIntervalMinutes: integer('poll_interval_minutes').notNull().default(60),
    enabled: boolean('enabled').notNull().default(true),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSnapshotJson: jsonb('last_snapshot_json'),
    lastError: text('last_error'),
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

export const watchEventsRelations = relations(watchEvents, ({ one }) => ({
  watch: one(parcelWatches, {
    fields: [watchEvents.watchId],
    references: [parcelWatches.id],
  }),
}))

export type ParcelWatch = typeof parcelWatches.$inferSelect
export type WatchEvent = typeof watchEvents.$inferSelect
export type UserNotificationSettings =
  typeof userNotificationSettings.$inferSelect
