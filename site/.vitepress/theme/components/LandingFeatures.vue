<script setup lang="ts">
interface Feature {
  title: string
  text: string
}

// Derived from docs/self-hosting.md, docs/self-hosting.cs.md and CHANGELOG.md.
const features: Array<Feature> = [
  {
    title: 'Parcely, stavby, jednotky a práva stavby',
    text: 'Každý registr katastru se sleduje jako samostatný objekt s vlastním snímkem, historií, intervalem a pravidly upozornění. Detail nabídne i navázané objekty.',
  },
  {
    title: 'Přidání podle adresy',
    text: 'Adresní místa našeptává RÚIAN. Přesná shoda vede přes kód adresního místa ke stavbě, kterou Hlídač nabídne spolu s jednotkami a parcelami.',
  },
  {
    title: 'Sledování řízení',
    text: 'Nová řízení a plomby, změny stavu, provedené operace i stav úhrady. Řízení se dosleduje i po odebrání plomby, takže víte, jak skutečně dopadlo.',
  },
  {
    title: 'Historie změn před a po',
    text: 'Každá událost ukládá původní i novou hodnotu (Výměra: 976 → 980 m²) a snímek, ze kterého vznikla. Historii lze filtrovat a exportovat do CSV či JSON.',
  },
  {
    title: 'Upozornění podle vašich pravidel',
    text: 'Gotify, Slack, Discord, ntfy a e-mail (SMTP). Výběr událostí a kanálů pro každé sledování, tiché hodiny, denní a týdenní souhrny a spolehlivá fronta s opakováním.',
  },
  {
    title: 'Katastrální mapa',
    text: 'Mapa KN s ortofotem, definičními body a přesnou geometrií parcel z INSPIRE CP. Z mapy lze vybrat parcelu nebo sousední parcely a po ověření je přidat.',
  },
  {
    title: 'Portfolio a štítky',
    text: 'Soukromé štítky a poznámky, vyhledávání bez diakritiky, filtry podle KÚ, LV a stavu, přehled podle LV a hromadné pozastavení či změna intervalu. Import z CSV/JSON.',
  },
  {
    title: 'SSO a soukromá registrace',
    text: 'Přihlášení přes OIDC (Authentik, Keycloak…) i heslem. Výchozí instance je soukromá: účty zakládá správce, případně je možné zvát pozvánkami.',
  },
  {
    title: 'Denní rozpočet ČÚZK API',
    text: 'Web, worker i CLI sdílejí denní limit 500 pokusů. Administrace ukazuje spotřebu, chyby a odhad plánovaných volání, sdílená data se stahují jen jednou.',
  },
  {
    title: 'Šifrované zálohy s resticem',
    text: 'Volitelné plánované zálohy databáze i konfigurace do vzdáleného úložiště (S3, SFTP, REST) a ověřená obnova do prázdné databáze.',
  },
  {
    title: 'Multiarch Docker image',
    text: 'Image pro amd64 i arm64 v GHCR s SLSA provenance a SBOM. Web, worker i migrace běží pod UID 1000 s read-only souborovým systémem.',
  },
  {
    title: 'Metriky pro Prometheus',
    text: 'Endpoint /api/metrics chráněný tokenem vystavuje rozpočet API, stav účtu ČÚZK a stav workeru. Připravená pravidla upozorní na výpadek kontrol.',
  },
]

const pad = (n: number) => String(n).padStart(2, '0')
</script>

<template>
  <section class="landing-section" aria-labelledby="funkce">
    <div class="landing-container">
      <p class="landing-eyebrow">Co umí</p>
      <h2 id="funkce" class="landing-title">
        Změny, které u nemovitosti opravdu počítají
      </h2>
      <p class="landing-lead">
        Hlídač pravidelně kontroluje veřejná data ČÚZK a upozorní vás dřív, než
        změnu sami objevíte v nahlížení do katastru.
      </p>
      <ul class="landing-features">
        <li
          v-for="(feature, index) in features"
          :key="feature.title"
          class="landing-feature"
        >
          <p class="landing-feature-number" aria-hidden="true">
            {{ pad(index + 1) }}
          </p>
          <h3>{{ feature.title }}</h3>
          <p>{{ feature.text }}</p>
        </li>
      </ul>
    </div>
  </section>
</template>
