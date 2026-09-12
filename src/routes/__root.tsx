import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ImpersonationBanner } from '#/components/impersonation-banner'
import { ThemeProvider } from '#/components/theme-provider'
import { themeInitScript } from '#/lib/theme'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      {
        rel: 'icon',
        href: '/favicon-32x32.png',
        type: 'image/png',
        sizes: '32x32',
      },
      {
        rel: 'icon',
        href: '/favicon-16x16.png',
        type: 'image/png',
        sizes: '16x16',
      },
      { rel: 'shortcut icon', href: '/favicon.ico' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
    ],
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Hlídač ČÚZK',
      },
      {
        name: 'description',
        content: 'Sledování parcel ČÚZK a notifikace změn',
      },
      { name: 'theme-color', content: '#245A72' },
      { name: 'apple-mobile-web-app-title', content: 'Hlídač ČÚZK' },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  return (
    <ThemeProvider>
      <ImpersonationBanner />
      <Outlet />
    </ThemeProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
