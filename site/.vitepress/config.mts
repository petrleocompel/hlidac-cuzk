import { defineConfig } from 'vitepress'

const REPO = 'https://github.com/petrleocompel/hlidac-cuzk'
const SITE_URL = 'https://petrleocompel.github.io/hlidac-cuzk/'
const base = '/hlidac-cuzk/'
const description =
  'Self-hosted hlídání parcel, staveb, jednotek a řízení v katastru nemovitostí ČÚZK s upozorněním na změny.'

/**
 * GitHub-compatible heading ids, so that anchors written for GitHub
 * (e.g. `#síťové-závislosti`, `#upgrade`) keep working on the website.
 */
function githubSlugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

export default defineConfig({
  lang: 'cs',
  title: 'Hlídač ČÚZK',
  description,
  base,
  cleanUrls: true,
  lastUpdated: false,
  srcExclude: ['README.md'],
  // No dead-link exceptions: internal links must resolve or the build fails.
  ignoreDeadLinks: false,

  head: [
    [
      'link',
      { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' },
    ],
    [
      'link',
      {
        rel: 'icon',
        href: `${base}favicon-32x32.png`,
        type: 'image/png',
        sizes: '32x32',
      },
    ],
    ['link', { rel: 'alternate icon', href: `${base}favicon.ico` }],
    [
      'link',
      {
        rel: 'apple-touch-icon',
        href: `${base}apple-touch-icon.png`,
        sizes: '180x180',
      },
    ],
    ['meta', { name: 'theme-color', content: '#245A72' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Hlídač ČÚZK' }],
    ['meta', { property: 'og:title', content: 'Hlídač ČÚZK' }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { property: 'og:locale', content: 'cs_CZ' }],
    [
      'meta',
      { property: 'og:image', content: `${SITE_URL}apple-touch-icon.png` },
    ],
    ['meta', { name: 'twitter:card', content: 'summary' }],
  ],

  markdown: {
    anchor: { slugify: githubSlugify },
  },

  themeConfig: {
    logo: { src: '/favicon.svg', alt: '' },
    siteTitle: 'Hlídač ČÚZK',

    nav: [
      { text: 'Úvod', link: '/uvod', activeMatch: '^/uvod' },
      {
        text: 'Instalace',
        link: '/docs/instalace',
        activeMatch: '^/docs/(instalace|self-hosting)',
      },
      { text: 'Změny', link: '/docs/changelog' },
    ],

    sidebar: [
      {
        text: 'Dokumentace',
        items: [
          { text: 'Úvod', link: '/uvod' },
          { text: 'Instalace', link: '/docs/instalace' },
          { text: 'Self-hosting (EN)', link: '/docs/self-hosting' },
          { text: 'Testování (EN)', link: '/docs/testing' },
        ],
      },
      {
        text: 'Projekt',
        items: [
          { text: 'Změny', link: '/docs/changelog' },
          { text: 'Přispívání (EN)', link: '/docs/contributing' },
          { text: 'Bezpečnost (EN)', link: '/docs/security' },
          { text: 'GitHub', link: REPO },
        ],
      },
      {
        text: 'Výzkum',
        collapsed: true,
        items: [
          {
            text: 'Návaznost parcel, LV a WSDP',
            link: '/docs/cuzk-successors-wsdp-research',
          },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: REPO, ariaLabel: 'Hlídač ČÚZK na GitHubu' },
    ],

    editLink: {
      // Serialized to the client: keep it self-contained.
      pattern: ({ filePath, frontmatter }) =>
        typeof frontmatter.source === 'string'
          ? `https://github.com/petrleocompel/hlidac-cuzk/edit/main/${frontmatter.source}`
          : `https://github.com/petrleocompel/hlidac-cuzk/edit/main/site/${filePath}`,
      text: 'Upravit tuto stránku na GitHubu',
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: 'Hledat',
            buttonAriaLabel: 'Hledat v dokumentaci',
          },
          modal: {
            displayDetails: 'Zobrazit podrobnosti',
            resetButtonTitle: 'Vymazat hledání',
            backButtonTitle: 'Zavřít hledání',
            noResultsText: 'Nic nenalezeno pro',
            footer: {
              selectText: 'vybrat',
              selectKeyAriaLabel: 'Enter',
              navigateText: 'přejít',
              navigateUpKeyAriaLabel: 'šipka nahoru',
              navigateDownKeyAriaLabel: 'šipka dolů',
              closeText: 'zavřít',
              closeKeyAriaLabel: 'Escape',
            },
          },
        },
      },
    },

    outline: { level: [2, 3], label: 'Na této stránce' },
    docFooter: { prev: 'Předchozí', next: 'Další' },
    darkModeSwitchLabel: 'Vzhled',
    lightModeSwitchTitle: 'Přepnout na světlý režim',
    darkModeSwitchTitle: 'Přepnout na tmavý režim',
    sidebarMenuLabel: 'Menu',
    returnToTopLabel: 'Zpět nahoru',
    langMenuLabel: 'Jazyk',
    skipToContentLabel: 'Přeskočit na obsah',
    notFound: {
      title: 'STRÁNKA NENALEZENA',
      quote: 'Tahle parcela v katastru není. Zkuste začít na úvodní stránce.',
      linkLabel: 'přejít na úvodní stránku',
      linkText: 'Zpět na úvod',
    },
    externalLinkIcon: true,
  },
})
