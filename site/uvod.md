# Úvod

**Hlídač ČÚZK** je open-source aplikace, kterou provozujete na vlastním serveru. Pravidelně
kontroluje veřejná data katastru nemovitostí přes REST API ČÚZK a upozorní vás, když se
u sledované parcely, stavby, jednotky nebo práva stavby objeví nové řízení, plomba, změna
listu vlastnictví nebo jiného sledovaného údaje.

Rozhraní aplikace je česky. Projekt je licencovaný pod
[AGPL-3.0-only](https://github.com/petrleocompel/hlidac-cuzk/blob/main/LICENSE) a není
oficiální službou ČÚZK.

## Co budete potřebovat

- server s Dockerem a Docker Compose v2 (pro osobní použití stačí malý VPS, 1 vCPU a 1–2 GB RAM),
- vlastní API klíč ČÚZK pro [REST API katastru nemovitostí](https://api-kn.cuzk.gov.cz),
- doménu a HTTPS (reverzní proxy na stejném hostiteli, nebo Caddy jako kontejner),
- volitelně notifikační kanál (Gotify, Slack, Discord, ntfy, SMTP) a poskytovatele SSO (OIDC).

Image `ghcr.io/petrleocompel/hlidac-cuzk` je veřejný a multiarch (amd64 i arm64). Vydání
`vX.Y.Z` publikuje tagy `X.Y.Z`, `X.Y`, `X` a `latest`; každý push do `main` publikuje
`edge` a `sha-<7 znaků commitu>`. Pro provoz připněte konkrétní verzi, ideálně její digest.

## Dokumentace

| Stránka                                     | Obsah                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [Instalace](./docs/instalace.md)            | Český návod: konfigurace, proxy, domácí síť, externí PostgreSQL, aktualizace a obnova          |
| [Self-hosting (EN)](./docs/self-hosting.md) | Úplná provozní dokumentace: proměnné prostředí, SSO, notifikace, rozpočet API, metriky, zálohy |
| [Testování (EN)](./docs/testing.md)         | Jednotkové a integrační testy s PostgreSQL                                                     |
| [Změny](./docs/changelog.md)                | Přehled změn ve vydáních a postup migrace                                                      |
| [Přispívání (EN)](./docs/contributing.md)   | Vývojové prostředí, pull requesty a vydávání                                                   |
| [Bezpečnost (EN)](./docs/security.md)       | Jak soukromě nahlásit zranitelnost a podporované verze                                         |

Dokumentace na tomto webu se generuje z Markdownu v
[repozitáři](https://github.com/petrleocompel/hlidac-cuzk). Opravy posílejte jako pull request
do původních souborů ve složce `docs/` nebo v kořeni repozitáře.
