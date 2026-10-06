<script setup lang="ts">
import { withBase } from 'vitepress'
</script>

<template>
  <section class="hero" aria-labelledby="hero-title">
    <!-- Static port of src/components/marketing/landing-hero-visual.tsx -->
    <div class="hero-visual" aria-hidden="true">
      <div class="hero-glow" />
      <svg
        class="hero-grid"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <pattern
            id="landing-cadastre"
            width="72"
            height="72"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 0h72v72H0z"
              fill="none"
              stroke="rgba(247,245,240,0.22)"
              stroke-width="1"
            />
            <path
              d="M36 0v72M0 36h72"
              fill="none"
              stroke="rgba(247,245,240,0.12)"
              stroke-width="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#landing-cadastre)" />
      </svg>
      <div class="hero-mark">
        <svg
          class="hero-shield"
          viewBox="0 0 200 240"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
        >
          <path
            fill="rgba(247,245,240,0.94)"
            d="M100 12 176 42v68c0 48-33 92-76 106C57 202 24 158 24 110V42L100 12Z"
          />
          <path
            fill="#245A72"
            d="M100 72c-18 0-32.5 14-32.5 31.5 0 22.5 26 55.5 30.5 61a2.8 2.8 0 0 0 4 0c4.5-5.5 30.5-38.5 30.5-61C132.5 86 118 72 100 72Zm0 44.5a13 13 0 1 1 0-26 13 13 0 0 1 0 26Z"
          />
        </svg>
      </div>
      <div class="hero-scrim-bottom" />
      <div class="hero-scrim-side" />
    </div>

    <div class="hero-copy">
      <p class="hero-eyebrow fade-up">Open source · self-hosted</p>
      <h1 id="hero-title" class="hero-title fade-up">Hlídač ČÚZK</h1>
      <p class="hero-lead fade-up delay-1">
        Sledování parcel, staveb, jednotek a řízení v katastru nemovitostí a
        upozornění na změny — na vašem vlastním serveru.
      </p>
      <div class="hero-actions fade-up delay-2">
        <a
          class="hero-button hero-button--primary"
          :href="withBase('/docs/instalace')"
        >
          Nainstalovat
        </a>
        <a
          class="hero-button hero-button--outline"
          href="https://github.com/petrleocompel/hlidac-cuzk"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
            />
          </svg>
          GitHub
        </a>
      </div>
      <p class="hero-meta fade-up delay-3">
        AGPL-3.0-only · Docker image pro amd64 i arm64 ·
        <code>ghcr.io/petrleocompel/hlidac-cuzk</code>
      </p>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  min-height: min(52rem, calc(100svh - var(--vp-nav-height)));
  background: var(--hc-hero-bg);
  color: var(--hc-hero-ink);
}

@media (min-width: 960px) {
  .hero {
    justify-content: center;
    min-height: min(46rem, calc(100svh - var(--vp-nav-height)));
  }
}

.hero-visual {
  pointer-events: none;
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.hero-glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 80% 50% at 50% 0%,
      rgba(58, 160, 184, 0.32),
      transparent 55%
    ),
    radial-gradient(
      ellipse 70% 55% at 85% 40%,
      rgba(58, 160, 184, 0.22),
      transparent 60%
    ),
    radial-gradient(
      ellipse 50% 40% at 10% 90%,
      rgba(36, 90, 114, 0.55),
      transparent 55%
    );
}

.hero-grid {
  position: absolute;
  inset: 0;
  width: calc(100% + 72px);
  height: calc(100% + 72px);
  opacity: 0.28;
  animation: grid-drift 48s linear infinite;
}

@media (min-width: 960px) {
  .hero-grid {
    opacity: 0.35;
  }
}

/* Mobile: smaller mark in the upper field. Desktop: large side focal point. */
.hero-mark {
  position: absolute;
  top: 1.5rem;
  right: -8%;
  width: min(42vmin, 240px);
  height: min(42vmin, 240px);
  opacity: 0.8;
}

@media (min-width: 640px) {
  .hero-mark {
    top: 3rem;
    right: 0;
    width: min(46vmin, 280px);
    height: min(46vmin, 280px);
  }
}

@media (min-width: 960px) {
  .hero-mark {
    top: 50%;
    right: 2%;
    width: auto;
    max-width: 46vw;
    height: min(72%, 520px);
    transform: translateY(-50%);
    opacity: 0.9;
  }
}

.hero-shield {
  width: 100%;
  height: 100%;
  animation: shield-rise 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@media (min-width: 960px) {
  .hero-shield {
    width: auto;
  }
}

.hero-scrim-bottom {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 62%;
  background: linear-gradient(
    to top,
    var(--hc-hero-bg),
    rgb(26 63 82 / 0.92),
    transparent
  );
}

.hero-scrim-side {
  display: none;
}

@media (min-width: 960px) {
  .hero-scrim-bottom {
    display: none;
  }

  .hero-scrim-side {
    position: absolute;
    inset-block: 0;
    left: 0;
    display: block;
    width: 58%;
    background: linear-gradient(
      to right,
      var(--hc-hero-bg),
      rgb(26 63 82 / 0.8),
      transparent
    );
  }
}

.hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  margin-inline: auto;
  width: 100%;
  max-width: 72rem;
  padding: 9rem 1rem max(2.5rem, env(safe-area-inset-bottom));
}

@media (min-width: 640px) {
  .hero-copy {
    padding: 10rem 1.5rem 4rem;
  }
}

@media (min-width: 960px) {
  .hero-copy {
    padding: 5rem 2.5rem 6rem;
  }
}

.hero-eyebrow {
  margin: 0 0 1rem;
  color: rgb(247 245 240 / 0.75);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.hero-title {
  margin: 0;
  max-width: 14ch;
  border: 0;
  color: var(--hc-hero-ink);
  font-size: 2.5rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  line-height: 1.08;
  text-wrap: balance;
}

@media (min-width: 640px) {
  .hero-title {
    max-width: 48rem;
    font-size: 3rem;
  }
}

@media (min-width: 960px) {
  .hero-title {
    font-size: 4.5rem;
  }
}

.hero-lead {
  margin: 1rem 0 0;
  max-width: 36rem;
  color: var(--hc-hero-muted);
  font-size: 1rem;
  line-height: 1.65;
}

@media (min-width: 640px) {
  .hero-lead {
    margin-top: 1.5rem;
    font-size: 1.125rem;
  }
}

@media (min-width: 960px) {
  .hero-lead {
    font-size: 1.25rem;
  }
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 2rem;
  width: 100%;
}

@media (min-width: 640px) {
  .hero-actions {
    flex-flow: row wrap;
    margin-top: 2.5rem;
    width: auto;
  }
}

.hero-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--hc-radius);
  height: 3rem;
  padding-inline: 1.5rem;
  font-size: 1rem;
  font-weight: 500;
  text-decoration: none;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.hero-button svg {
  width: 1.125rem;
  height: 1.125rem;
}

.hero-button--primary {
  background: var(--hc-hero-ink);
  color: var(--hc-hero-bg);
}

.hero-button--primary:hover {
  background: #fff;
}

.hero-button--outline {
  border-color: rgb(142 196 212 / 0.5);
  background: transparent;
  color: var(--hc-hero-ink);
}

.hero-button--outline:hover {
  background: rgb(247 245 240 / 0.1);
}

.hero-button:focus-visible {
  outline: 2px solid var(--hc-hero-line);
  outline-offset: 3px;
}

.hero-meta {
  margin: 1.5rem 0 0;
  color: rgb(215 230 236 / 0.85);
  font-size: 0.875rem;
  line-height: 1.6;
}

.hero-meta code {
  border-radius: 4px;
  background: rgb(247 245 240 / 0.1);
  padding: 0.1em 0.35em;
  color: var(--hc-hero-ink);
  font-family: var(--vp-font-family-mono);
  font-size: 0.85em;
  overflow-wrap: anywhere;
}

.fade-up {
  animation: fade-up 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.delay-1 {
  animation-delay: 90ms;
}

.delay-2 {
  animation-delay: 170ms;
}

.delay-3 {
  animation-delay: 250ms;
}

@keyframes fade-up {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes grid-drift {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(-36px, -18px, 0);
  }
}

@keyframes shield-rise {
  from {
    opacity: 0;
    transform: translate3d(24px, 18px, 0);
  }
  to {
    opacity: 0.9;
    transform: translate3d(0, 0, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fade-up,
  .hero-grid,
  .hero-shield {
    animation: none;
  }

  .hero-button {
    transition: none;
  }
}
</style>
