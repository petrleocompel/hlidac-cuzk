import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  foreignKey,
  check,
  bigint,
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

export const registrationInvitations = pgTable(
  'registration_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('registration_invitations_email_idx').on(table.email)],
)

export const rateLimit = pgTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
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
  /** ntfy topic URL; the token is only needed for protected topics. */
  useInstanceGotify: boolean('use_instance_gotify').notNull().default(false),
  ntfyUrl: text('ntfy_url'),
  ntfyToken: text('ntfy_token'),
  /** Recipient for the instance SMTP server; the server itself is admin config. */
  emailTo: text('email_to'),
  timezone: text('timezone').notNull().default('Europe/Prague'),
  /** Minutes from local midnight; null disables quiet hours. */
  quietFromMinutes: integer('quiet_from_minutes'),
  quietToMinutes: integer('quiet_to_minutes'),
  digestMode: text('digest_mode', { enum: ['off', 'daily', 'weekly'] })
    .notNull()
    .default('off'),
  digestHour: integer('digest_hour').notNull().default(8),
  /** ISO weekday 1 = Monday, used by the weekly digest. */
  digestWeekday: integer('digest_weekday').notNull().default(1),
  /** Event kinds delivered immediately despite quiet hours or a digest. */
  urgentKinds: text('urgent_kinds')
    .array()
    .notNull()
    .default(sql`'{new_rizeni,lv_change}'::text[]`),
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
    notes: text('notes').notNull().default(''),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Which KN register the subscription follows; parcels are the default. */
    objectType: text('object_type', {
      enum: ['parcel', 'stavba', 'jednotka', 'pravo_stavby'],
    })
      .notNull()
      .default('parcel'),
    /** Verified human identification of the object, e.g. `č.p. 123`. */
    objectSummary: text('object_summary'),
    // Katastrální území and parcel numbers stay empty for objects that have none.
    kuCode: text('ku_code'),
    kuName: text('ku_name'),
    parcelNumber: integer('parcel_number'),
    parcelSubdivision: integer('parcel_subdivision'),
    druhCislovani: integer('druh_cislovani').notNull().default(2),
    isknId: text('iskn_id').notNull(),
    pollIntervalMinutes: integer('poll_interval_minutes')
      .notNull()
      .default(1440),
    enabled: boolean('enabled').notNull().default(true),
    // Legacy compatibility: last completed attempt, never use as freshness.
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessfulCheckAt: timestamp('last_successful_check_at', {
      withTimezone: true,
    }),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    lastSnapshotJson: jsonb('last_snapshot_json'),
    lastError: text('last_error'),
    pollClaimToken: uuid('poll_claim_token'),
    pollLockedUntil: timestamp('poll_locked_until', { withTimezone: true }),
    manualRefreshAfter: timestamp('manual_refresh_after', {
      withTimezone: true,
    }),
    /** null = every event kind / every configured channel. */
    notifyKinds: text('notify_kinds').array(),
    notifyChannels: text('notify_channels').array(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check('watch_notes_length', sql`char_length(${table.notes}) <= 5000`),
    check(
      'watch_tags_count',
      sql`cardinality(${table.tags}) <= 20 and coalesce(array_ndims(${table.tags}), 1) = 1 and array_position(${table.tags}, null) is null`,
    ),
    uniqueIndex('parcel_watches_owner_id_idx').on(table.userId, table.id),
    index('parcel_watches_userId_idx').on(table.userId),
    index('parcel_watches_enabled_idx').on(table.enabled),
    index('parcel_watches_next_check_idx').on(
      table.enabled,
      table.nextCheckAt.asc().nullsFirst(),
      table.id,
    ),
    // One subscription per user and object. ISKN ids are unique inside a register,
    // so the type is part of the key.
    uniqueIndex('parcel_watches_user_object_idx').on(
      table.userId,
      table.objectType,
      table.isknId,
    ),
  ],
)

/** User-declared relationships, never an authoritative cadastral succession. */
export const watchLinks = pgTable(
  'watch_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    fromWatchId: uuid('from_watch_id').notNull(),
    toWatchId: uuid('to_watch_id').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.fromWatchId],
      foreignColumns: [parcelWatches.userId, parcelWatches.id],
      name: 'watch_links_from_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.toWatchId],
      foreignColumns: [parcelWatches.userId, parcelWatches.id],
      name: 'watch_links_to_owner_fk',
    }).onDelete('cascade'),
    uniqueIndex('watch_links_edge_idx').on(table.fromWatchId, table.toWatchId),
    index('watch_links_target_idx').on(table.toWatchId),
    check(
      'watch_links_distinct',
      sql`${table.fromWatchId} <> ${table.toWatchId}`,
    ),
    check('watch_links_note_length', sql`char_length(${table.note}) <= 500`),
  ],
)

export const watchEvents = pgTable(
  'watch_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => parcelWatches.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // new_rizeni | rizeni_progress | lv_change | parcel_attrs | error
    payloadJson: jsonb('payload_json'),
    /** Snapshot as of this change, so history is not lost on the next overwrite. */
    snapshotJson: jsonb('snapshot_json'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('watch_events_watchId_idx').on(table.watchId),
    index('watch_events_created_idx').on(table.createdAt, table.id),
    index('watch_events_watch_created_idx').on(
      table.watchId,
      table.createdAt.desc(),
    ),
  ],
)

/**
 * A řízení followed as its own object: its history must survive the plomba
 * disappearing from the parcel. `detail_json` is the last known RizeniSnapshot.
 */
export const watchRizeni = pgTable(
  'watch_rizeni',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    watchId: uuid('watch_id')
      .notNull()
      .references(() => parcelWatches.id, { onDelete: 'cascade' }),
    rizeniId: text('rizeni_id').notNull(),
    source: text('source', { enum: ['plomba', 'manual'] })
      .notNull()
      .default('plomba'),
    typRizeni: text('typ_rizeni'),
    poradoveCislo: integer('poradove_cislo'),
    rok: integer('rok'),
    kodPracoviste: integer('kod_pracoviste'),
    /** Currently listed among the parcel plomby. */
    isPlomba: boolean('is_plomba').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    detachedAt: timestamp('detached_at', { withTimezone: true }),
    followUntil: timestamp('follow_until', { withTimezone: true }),
    followEndedAt: timestamp('follow_ended_at', { withTimezone: true }),
    followEndedReason: text('follow_ended_reason', {
      enum: ['window', 'unavailable', 'user', 'capacity'],
    }),
    detailJson: jsonb('detail_json'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
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
    uniqueIndex('watch_rizeni_watch_rizeni_idx').on(
      table.watchId,
      table.rizeniId,
    ),
    index('watch_rizeni_follow_idx').on(table.watchId, table.followEndedAt),
  ],
)

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => watchEvents.id, { onDelete: 'cascade' }),
    channel: text('channel', {
      enum: ['gotify', 'slack', 'discord', 'ntfy', 'email'],
    }).notNull(),
    // `deferred` waits for the next digest; it is never sent on its own.
    status: text('status', {
      enum: ['pending', 'processing', 'sent', 'failed', 'deferred'],
    })
      .notNull()
      .default('pending'),
    digest: boolean('digest').notNull().default(false),
    urgent: boolean('urgent').notNull().default(false),
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

export const workerHealth = pgTable('worker_health', {
  id: text('id').primaryKey(),
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  lastOutageAt: timestamp('last_outage_at', { withTimezone: true }),
  recoveredAt: timestamp('recovered_at', { withTimezone: true }),
})

export const workerJobs = pgTable('worker_jobs', {
  name: text('name').primaryKey(),
  runToken: uuid('run_token').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  lastSuccessfulAt: timestamp('last_successful_at', { withTimezone: true }),
  lastError: text('last_error'),
  summary: jsonb('summary').$type<Record<string, number | boolean>>(),
})

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
    rizeni: many(watchRizeni),
  }),
)

export const watchRizeniRelations = relations(watchRizeni, ({ one }) => ({
  watch: one(parcelWatches, {
    fields: [watchRizeni.watchId],
    references: [parcelWatches.id],
  }),
}))

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
export type WatchRizeni = typeof watchRizeni.$inferSelect
export type WatchEvent = typeof watchEvents.$inferSelect
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
export type UserNotificationSettings =
  typeof userNotificationSettings.$inferSelect

export const notificationPolicy = pgTable('notification_policy', {
  id: integer('id').primaryKey().default(1),
  gotifyEnabled: boolean('gotify_enabled').notNull().default(true),
  slackEnabled: boolean('slack_enabled').notNull().default(true),
  discordEnabled: boolean('discord_enabled').notNull().default(true),
  ntfyEnabled: boolean('ntfy_enabled').notNull().default(true),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  gotifyAllowedUrls: text('gotify_allowed_urls')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ntfyAllowedUrls: text('ntfy_allowed_urls')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const backupStatus = pgTable('backup_status', {
  kind: text('kind').primaryKey().$type<'database' | 'config'>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  lastSuccessfulAt: timestamp('last_successful_at', { withTimezone: true }),
  snapshotId: text('snapshot_id'),
  lastError: text('last_error'),
})

/** Minimal administration trail; no passwords, token values or provider configuration. */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: text('actor_id'),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('admin_audit_created_idx').on(table.createdAt, table.id)],
)
