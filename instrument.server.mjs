const dsn = process.env.SENTRY_DSN

if (dsn?.trim()) {
  const Sentry = await import('@sentry/tanstackstart-react')
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event, hint) {
      const message =
        hint?.originalException instanceof Error
          ? hint.originalException.message
          : undefined
      if (message === 'unauthenticated' || message === 'forbidden') {
        return null
      }
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        if (event.request.headers) {
          delete event.request.headers.cookie
          delete event.request.headers.authorization
        }
      }
      if (event.user) {
        const { id } = event.user
        event.user = { id }
      }
      return event
    },
  })
}
