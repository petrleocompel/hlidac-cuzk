import DefaultTheme from 'vitepress/theme-without-fonts'
import type { Theme } from 'vitepress'

// IBM Plex Sans is bundled with the site (OFL, see /licenses/) — no external font requests.
import '@fontsource-variable/ibm-plex-sans/wght.css'
import './custom.css'

import LandingFeatures from './components/LandingFeatures.vue'
import LandingFooter from './components/LandingFooter.vue'
import LandingHero from './components/LandingHero.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LandingHero', LandingHero)
    app.component('LandingFeatures', LandingFeatures)
    app.component('LandingFooter', LandingFooter)
  },
} satisfies Theme
