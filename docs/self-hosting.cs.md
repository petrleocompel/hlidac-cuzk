# Vlastní instance Hlídače ČÚZK

Aplikace, worker a PostgreSQL běží na vašem serveru. Výchozí registrace je soukromá:
nové účty zakládá správce. Pro běžný přístup použijte HTTPS, i v domácí síti.

## Stažení a konfigurace

Zdrojový projekt: [GitLab](https://github.com/petrleocompel/hlidac-cuzk),
[úspěšná vydání a pipeline](https://github.com/petrleocompel/hlidac-cuzk/actions),
[registry](https://github.com/petrleocompel/hlidac-cuzk/pkgs/container/hlidac-cuzk).
Image má adresu `ghcr.io/petrleocompel/hlidac-cuzk`. Projekt i registry mohou
vyžadovat váš GitLab účet nebo read-only deploy token; veřejný přístup není zaručen.
Heslo zadávejte interaktivně přes `docker login ghcr.io`.

```bash
git clone https://github.com/petrleocompel/hlidac-cuzk.git
cd hlidac-cuzk
corepack enable
pnpm install --frozen-lockfile
pnpm env:init deploy/.env
```

Soubor `deploy/.env` obsahuje unikátní klíče a má práva `0600`. Doplňte `ADMIN_EMAIL`,
`CUZK_API_KEY`, `APP_HOST` a `PUBLIC_URL`; uchovejte vygenerované heslo správce.
`PUBLIC_URL` musí přesně odpovídat URL v prohlížeči, včetně případného portu, bez cesty.
`APP_HOST` je pouze DNS jméno. Nezapínejte demo: `SEED_DEMO_WATCH=0`.
Nikdy nekopírujte skutečný `.env` do repozitáře ani výpisu podpory.

V registry vyberte osmiznakový commit tag z úspěšné pipeline. Image stáhněte a zjistěte
jeho digest příkazem `docker image inspect IMAGE --format '{{json .RepoDigests}}'`.
Do `deploy/.env` uložte `HLIDAC_CUZK_IMAGE=ghcr.io/petrleocompel/hlidac-cuzk@sha256:...`
s **celým skutečným digestem**, nikoli doslovně třemi tečkami. Nepřipínejte `latest`.
Alternativně sestavte vlastní image: `docker build -t hlidac-cuzk:local .` a nastavte
`HLIDAC_CUZK_IMAGE=hlidac-cuzk:local`. Tento lokální image před upgradem publikujte do
vlastní registry, protože upgrade skript vždy provede pull.

Následující příkazy se spouštějí v adresáři `deploy/`. Používejte stále stejný název
Compose projektu `hlidac_cuzk`. Zkontrolujte `docker compose version` (Compose v2 nebo novější).

## Proxy na stejném hostiteli

`docker-compose.selfhost.yml` publikuje aplikaci výchozím stavem jen na `127.0.0.1:3000`.
Do konfigurace Caddy na hostiteli zkopírujte [příklad](../deploy/Caddyfile.host.example)
a nahraďte doménu svou. Nastavte `PUBLIC_URL=https://hlidac.example.cz` a odpovídající
`APP_HOST`. Doména musí směřovat na server; TLS proxy potřebuje porty 80/443 pro veřejný
certifikát. Port 3000 nezpřístupňujte internetu.

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk config --quiet
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk up -d --wait
```

## TLS proxy jako kontejner

Použijte overlay `proxy` **místo** `selfhost`; aplikační port se na hostiteli nepublikuje.
[Caddyfile](../deploy/Caddyfile) čte doménu z `APP_HOST`. Veřejná doména získá automatický
certifikát; DNS a přístup na porty 80/443 musí fungovat. Certifikáty a stav Caddy jsou
v pojmenovaných volumes `caddy_data` a `caddy_config`.

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml -p hlidac_cuzk config --quiet
docker compose -f docker-compose.yml -f docker-compose.proxy.yml -p hlidac_cuzk up -d --wait
```

Proxy přepisuje klientské forwarding hlavičky. `AUTH_TRUST_PROXY_HEADERS=false` ponechte,
dokud nenastavíte konkrétní důvěryhodné proxy v `AUTH_TRUSTED_PROXIES` a neomezíte přímý
přístup k aplikaci. Nezadávejte celý internet jako důvěryhodnou síť. Bez zapnutí důvěry
zůstává omezení přihlášení aktivní, ale klienti mohou sdílet identitu proxy.
Viz [chování Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Domácí síť / LAN

Pro proxy na jiném stroji lze použít selfhost overlay a explicitně nastavit
`APP_BIND_ADDRESS=192.168.1.20` (skutečná IP tohoto serveru), `APP_HOST_PORT=3000`.
Firewall omezte na proxy. `0.0.0.0` znamená všechna IPv4 rozhraní, nikoli pouze domácí síť.
Publikovaný HTTP backend používejte za TLS proxy; `PUBLIC_URL` zůstává její HTTPS URL.

Pro čistě interní doménu nastavte lokální DNS, v Caddyfile přidejte `tls internal` a
nainstalujte kořenový certifikát Caddy do důvěryhodných certifikátů každého klienta.
Neobcházejte ověřování TLS při běžném používání. Přímé HTTP do LAN přenáší hesla bez
šifrování a produkční session cookies na něm nemusí fungovat; není to doporučený přístup.
Loopback HTTP je určený pro lokální diagnostiku (`/readyz`), nikoli pro veřejný login.

## Externí PostgreSQL

Použijte **samostatný** `docker-compose.external.yml`, nekombinujte jej s
`docker-compose.yml`. Neobsahuje službu `db`, databázový volume ani závislost na lokální DB.
V `.env` nastavte `DATABASE_URL` na adresu dostupnou **z kontejnerů**. `127.0.0.1` uvnitř
kontejneru je kontejner samotný; pro PostgreSQL na hostiteli Docker Desktop lze použít
`host.docker.internal`. Na Linuxu nakonfigurujte skutečnou síťovou adresu a firewall.

Databáze musí být vytvořená a migrační účet musí mít práva vytvářet tabulky, indexy a
schéma `drizzle`. Použijte PostgreSQL 16 a TLS podle poskytovatele. CA soubory musejí být
přimountované do app, cron i migrate na cestách uvedených v připojení; nevypínejte ověřování
certifikátů kvůli chybě konfigurace. `POSTGRES_*` proměnné se v této variantě nepoužívají.

```bash
docker compose -f docker-compose.external.yml -f docker-compose.selfhost.yml -p hlidac_cuzk config --quiet
docker compose -f docker-compose.external.yml -f docker-compose.selfhost.yml -p hlidac_cuzk up -d --wait
```

Selfhost lze opět nahradit `docker-compose.proxy.yml`. Předchozí lokální databáze se
změnou konfigurace nepřenese: nejprve zastavte zapisující procesy a proveďte ověřenou
obnovu do nové prázdné DB. Zálohování externí DB nastavte samostatně u jejího provozovatele.

## Ověření, aktualizace a obnova

Po prvním startu ověřte `/readyz`, přihlášení správce a administraci monitoringu.
`docker compose ... run --rm --no-deps app pnpm run doctor` provede diagnostiku bez
spotřeby ČÚZK API. Pro SSO povolte u poskytovatele přesné callbacky:
`PUBLIC_URL/api/auth/sso/callback/PROVIDER_ID` a `PUBLIC_URL/api/sso-link/callback`.
Skutečné odkazy ukazuje Admin → SSO; poskytovatele i jeho dostupnost ověřte přihlášením.

Pro existující vestavěnou DB použijte [postup upgradu](self-hosting.md#upgrade), například
`sh upgrade.sh docker-compose.selfhost.yml hlidac_cuzk`. Pro kontejnerovou proxy použijte
`docker-compose.proxy.yml`; při změně její konfigurace ji poté znovu vytvořte příkazem
`docker compose -f docker-compose.yml -f docker-compose.proxy.yml -p hlidac_cuzk up -d --no-deps proxy`.
Zálohujte DB i konfiguraci/klíče, zastavte workery, spusťte migraci jednou a ověřte readiness.
Pro externí DB skript `upgrade.sh` nepoužívejte: po její ověřené záloze proveďte `stop cron app`,
`up --no-deps --force-recreate --exit-code-from migrate migrate`,
`up -d --no-deps --wait app` a teprve poté `up -d --no-deps cron` se stejnými `-f` soubory.
Při chybě předchozího kroku nepokračujte. Před údržbou stáhněte zvolený image.

[Šifrované zálohy a obnova](self-hosting.md#scheduled-encrypted-backups-and-verified-restore)
jsou volitelné; dokud není vyplněný vzdálený cíl, neběží automatická ochrana mimo server.
Lokální upgrade dump nezahrnuje env a klíče. Obnovujte do prázdné databáze a zachovejte
odpovídající image i tajné klíče. Návrat starého image nevrátí nekompatibilní změnu schématu.

## Síťové závislosti

| Cíl | Kdy je potřeba |
| --- | --- |
| PostgreSQL | Web, bootstrap, cron, metriky a zálohy |
| `api-kn.cuzk.gov.cz` | Vyhledávání a kontroly; společný limit 500 pokusů/den |
| Nastavený OIDC poskytovatel | Přihlášení SSO a jeho bootstrap |
| Zvolené Gotify/Slack/Discord servery | Odesílání notifikací |
| Sentry | Pouze při nastaveném DSN |
| Registry, zdroje balíčků, ACME | Instalace/build/aktualizace a vydávání TLS certifikátů |
| Cíl resticu | Pokud zapnete vzdálené zálohy |

Přesný seznam prohlížečových zdrojů je v [provozní dokumentaci](self-hosting.md).
Externí fonty řeší následující úkol HOST-09. Žádná z instalačních diagnostik sama nemusí
volat ČÚZK ani posílat zprávy.
