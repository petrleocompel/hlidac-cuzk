<script setup lang="ts">
import { withBase } from 'vitepress'

const repo = 'https://github.com/petrleocompel/hlidac-cuzk'
</script>

<template>
  <footer class="landing-footer">
    <div class="landing-container landing-footer-inner">
      <div>
        <p class="landing-footer-name">
          <img :src="withBase('/favicon.svg')" alt="" width="20" height="20" />
          Hlídač ČÚZK
        </p>
        <p class="landing-footer-text">
          Sledování nemovitostí a notifikace změn z katastru nemovitostí.
          Projekt není oficiální službou ČÚZK.
        </p>
      </div>
      <nav aria-label="Odkazy v patičce">
        <ul class="landing-footer-links">
          <li><a :href="withBase('/uvod')">Dokumentace</a></li>
          <li><a :href="repo">GitHub</a></li>
          <li><a :href="`${repo}/releases`">Vydání</a></li>
          <li>
            <a :href="withBase('/docs/security')">Bezpečnostní politika</a>
          </li>
          <li>
            <a :href="`${repo}/blob/main/LICENSE`">Licence AGPL-3.0-only</a>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.landing-footer {
  border-top: 1px solid var(--hc-border);
  color: var(--hc-muted-foreground);
  font-size: 0.875rem;
  line-height: 1.6;
}

.landing-footer-inner {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-block: 2.5rem max(2.5rem, env(safe-area-inset-bottom));
}

@media (min-width: 960px) {
  .landing-footer-inner {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
  }
}

.landing-footer-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  color: var(--hc-foreground);
  font-weight: 600;
}

.landing-footer-text {
  margin: 0.5rem 0 0;
  max-width: 32rem;
}

.landing-footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.landing-footer-links a {
  color: var(--hc-foreground);
  text-decoration: underline;
  text-decoration-color: var(--hc-border);
  text-underline-offset: 3px;
}

.landing-footer-links a:hover {
  color: var(--hc-primary);
  text-decoration-color: currentColor;
}
</style>
