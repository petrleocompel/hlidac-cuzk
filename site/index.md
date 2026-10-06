---
layout: page
title: Hlídač ČÚZK
titleTemplate: Hlídání katastru nemovitostí na vlastním serveru
pageClass: landing-page
sidebar: false
aside: false
footer: false
---

<script setup>
import { withBase } from 'vitepress'
</script>

<div class="landing">

<LandingHero />

<LandingFeatures />

<section class="landing-section landing-section--muted" aria-labelledby="rychla-instalace">
<div class="landing-container">

<p class="landing-eyebrow">Rychlá instalace</p>
<h2 id="rychla-instalace" class="landing-title">Docker Compose na vlastním serveru</h2>
<p class="landing-lead">
Stručný výtah z <a :href="withBase('/docs/instalace')">návodu k instalaci</a>. Před ostrým provozem si přečtěte celý návod — hlavně nastavení HTTPS proxy, záloh a postup aktualizace.
</p>

<ol class="landing-steps">
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">1</p>
<div class="landing-prose vp-doc">
<h3>Stažení a vygenerování konfigurace</h3>
<p><code>env:init</code> vytvoří <code>deploy/.env</code> s unikátními klíči a právy <code>0600</code>.</p>

```bash
git clone https://github.com/petrleocompel/hlidac-cuzk.git
cd hlidac-cuzk
npm install --global corepack  # Node 25+ už Corepack nepřibaluje
corepack enable
pnpm install --frozen-lockfile
pnpm env:init deploy/.env
```

</div>
</li>
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">2</p>
<div class="landing-prose vp-doc">
<h3>Doplnění údajů a připnutí image</h3>
<p>V <code>deploy/.env</code> doplňte <code>ADMIN_EMAIL</code>, <code>CUZK_API_KEY</code>, <code>APP_HOST</code> a <code>PUBLIC_URL</code>. V <a href="https://github.com/petrleocompel/hlidac-cuzk/releases">GitHub Releases</a> vyberte verzi <code>X.Y.Z</code>, stáhněte image a zjistěte jeho digest:</p>

```bash
docker pull ghcr.io/petrleocompel/hlidac-cuzk:X.Y.Z
docker image inspect ghcr.io/petrleocompel/hlidac-cuzk:X.Y.Z --format '{{json .RepoDigests}}'
```

<p>Do <code>deploy/.env</code> uložte <code>HLIDAC_CUZK_IMAGE=ghcr.io/petrleocompel/hlidac-cuzk@sha256:…</code> s celým skutečným digestem. Nepřipínejte <code>latest</code> ani <code>edge</code>.</p>
</div>
</li>
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">3</p>
<div class="landing-prose vp-doc">
<h3>Spuštění</h3>
<p>Příkazy se spouštějí v adresáři <code>deploy/</code>. Overlay <code>selfhost</code> publikuje aplikaci jen na <code>127.0.0.1:3000</code> pro TLS proxy na stejném hostiteli.</p>

```bash
cd deploy
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk config --quiet
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk up -d --wait
```

</div>
</li>
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">4</p>
<div class="landing-prose vp-doc">
<h3>Ověření</h3>
<p>Diagnostika bez spotřeby ČÚZK API, poté zkontrolujte <code>/readyz</code> a přihlášení správce.</p>

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm --no-deps app pnpm run doctor
```

</div>
</li>
</ol>

<div class="landing-actions">
<a class="landing-button landing-button--primary" :href="withBase('/docs/instalace')">Celý návod k instalaci</a>
<a class="landing-button landing-button--outline" :href="withBase('/docs/self-hosting')" lang="en">Self-hosting guide (English)</a>
</div>

</div>
</section>

<section class="landing-section" aria-labelledby="jak-to-funguje">
<div class="landing-container">

<p class="landing-eyebrow">Jak to funguje</p>
<h2 id="jak-to-funguje" class="landing-title">Aplikace, worker a PostgreSQL</h2>
<p class="landing-lead">
Všechny části běží z jednoho Docker image na vašem serveru. Ven se instance připojuje jen k ČÚZK, k vámi zvoleným notifikačním službám a případně k poskytovateli SSO — <a :href="withBase('/docs/instalace#síťové-závislosti')">přehled síťových závislostí</a>.
</p>

<ol class="landing-steps">
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">1</p>
<div class="landing-prose">
<h3>Aplikace</h3>
<p>Webové rozhraní pro přidávání sledování, historii, mapu a administraci. Přihlášení heslem nebo přes SSO (OIDC); za HTTPS reverzní proxy.</p>
</div>
</li>
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">2</p>
<div class="landing-prose">
<h3>Worker</h3>
<p>Každých pět minut vybere sledování, která jsou na řadě (výchozí interval je jednou denně), stáhne data z REST API katastru a porovná je s posledním snímkem. Každou minutu doručuje upozornění z fronty a každých šest hodin kontroluje stav účtu ČÚZK.</p>
</div>
</li>
<li class="landing-step">
<p class="landing-step-number" aria-hidden="true">3</p>
<div class="landing-prose">
<h3>PostgreSQL 16</h3>
<p>Uchovává snímky, historii změn, frontu notifikací i počítadlo denního rozpočtu API. Může běžet v Compose, nebo jako externí databáze.</p>
</div>
</li>
</ol>

<div class="landing-note">
<p><strong>Potřebujete vlastní API klíč ČÚZK.</strong> Hlídač čte data z REST API katastru nemovitostí <a href="https://api-kn.cuzk.gov.cz">api-kn.cuzk.gov.cz</a>; klíč je zdarma a získáte ho registrací přes Identitu občana — <a :href="withBase('/docs/instalace#api-klíč-čúzk')">návod</a>. Instalace hlídá denní limit 500 pokusů. Projekt není oficiální službou ČÚZK.</p>
</div>

</div>
</section>

<LandingFooter />

</div>
