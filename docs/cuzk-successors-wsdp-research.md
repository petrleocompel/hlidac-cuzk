# ČÚZK: návaznost parcel, úplný LV a oficiální sledování změn

Ověřeno 14. září 2026. Výstup průzkumu NEXT-05 a NEXT-06. Čteny byly veřejné dokumentace, OpenAPI, WSDL a XSD; nebylo provedeno autentizované volání KN, objednána placená sestava ani aktivována služba. Návrhy níže popisují možné navazující řešení, nikoli již nasazený adaptér.

## Výsledek pro základní selfhosting

Zachovat stávající REST KN. Při nenalezení parcely uchovat poslední známý stav a historii; nabídnout ruční propojení samostatných sledování. Automatické rozdělení, sloučení ani převod sledování není podložen nalezeným kontraktem. WSDP a SSZ mají smysl jako oddělené, výslovně zapnuté adaptéry s vlastními účty. SSZ může dodat doloženou událost zániku pro oprávněného odběratele; úplné LV lze získat přes WSDP za samostatnou úplatu.

## NEXT-05: co zdroje skutečně dokazují

| Zdroj | Ověřený kontrakt | Důsledek |
| --- | --- | --- |
| REST KN v1.0 | `GET /api/v1/Parcely/{id}` vrací `ParcelaVysledekZpracovani`; HTTP 404 je popsáno pouze jako `Not Found`. Ve 41 zveřejněných cestách ani typu `Parcela` není operace historie/nástupců, datum zániku ani seznam předchůdců. | 404 neprokazuje právní zánik. `katastralniUzemiPuvodni` a `zdrojParcelyZE` nejsou vazbou na nástupce. [OpenAPI](https://api-kn.cuzk.gov.cz/swagger/v1.0/swagger.json) |
| INSPIRE CP WFS 2.0 | `CadastralParcelType` obsahuje `beginLifespanVersion`, `endLifespanVersion`, `validFrom`, `validTo`, ale také připouští nil; nemá předchůdce/nástupce. | Životnost verze prostorového objektu neidentifikuje parcelu vzniklou rozdělením. [Živé DescribeFeatureType](https://services.cuzk.gov.cz/wfs/inspire-cp-wfs.asp?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=cp:CadastralParcel) |
| WFS dokumentace | Popisuje dotazy podle ID, BBOX a stored queries; předpřipravené GML se obnovují denně. Příklady obsahují i nevyplněné životnostní údaje. | Nenalezený polygon a čas verze nejsou důkaz návaznosti. V prozkoumané dokumentaci není historický nástupnický dotaz. [ČÚZK CP download, v1.8, 14. 2. 2023](https://services.cuzk.cz/doc/inspire-cp-download.pdf) |
| SSZ/OZS | Událost `U9` označuje zánik nemovitosti; dokumentace uvádí rozdělení parcely jako příklad. Typy změn jsou `INS`, `UPD`, `DEL`. | Lze doložit zánik identifikovaného objektu, nikoli z toho automaticky odvodit všechny nové parcely. V posouzeném kontraktu nebyla nalezena explicitní vazba předchůdce → nástupci. [SSZ 2.9, dokumentace a XSD](https://cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Sledovani-zmen/Popis-webove-sluzby-pro-sledovani-zmen-udaju-o-nem/WS_SSZ_10_0_20231411.aspx) |

Jde o vymezení ověřených služeb, nikoli tvrzení, že historické podklady nikde v ČÚZK neexistují. Dvě sestavy k různým datům mohou ukázat rozdíl; samy neurčují kauzální vazbu rozdělení nebo sloučení. Geometrická podobnost, společné číslo řízení či podobné parcelní číslo jsou nejvýše podnětem k ručnímu ověření.

### Doporučené chování aplikace

- **Chyba ověření:** timeout, nevalidní odpověď, 401/403, 429 a 5xx. Zachovat poslední úspěšný snapshot; nepřepnout do stavu zániku. Vyčerpání místního denního limitu je odklad, nikoli chyba objektu.
- **Nenalezeno při kontrole:** pouze odpověď z očekávaného detailního endpointu, s uloženým časem a stavem HTTP. Opakování může potvrdit dlouhodobé nenalezení, stále však nesmí změnit text na „parcela zanikla“. Prázdná mapa nebo výsledek vyhledávání nestačí.
- **Zánik doložen zdrojem:** až při validované, objektově přiřazené oficiální události, například U9; uchovat identifikátor zprávy a původ. Ruční údaj uživatele označit zvlášť jako jeho tvrzení.
- **Ruční návaznost:** uživatel vybere již ověřené vlastní sledování, přidá nepovinnou poznámku a potvrdí vazbu. Zobrazit „Ruční návaznost“, nikoli potvrzené rozdělení/sloučení. Nevyměnit ISKN ID původního sledování; historie obou zůstává samostatná. Povolit více vazeb, kontrolovat vlastnictví obou stran, duplicity a propojení se sebou samým. Vytvoření nového sledování dál podléhá běžným kvótám.

Akceptační scénáře: 404 po úspěšném snapshotu; 404 → úspěch; 429 a lokální limit; vadný JSON; dočasně prázdná WFS geometrie; znovupoužité podobné parcelní číslo; souběžné založení vazby; cizí sledování; více ručních nástupců. Ani jeden chybový scénář nesmí smazat historii či automaticky začít hlídat jiný objekt.

## NEXT-06: WSDP pro úplný LV

WSDP vyžaduje samostatný zákaznický účet; účet DP ani REST ApiKey jej nenahrazuje. Nabízí LV a další výstupy v PDF/XML. Pro nový adaptér zvolit **WSDP 3.1**: hlavní stránka uvádí platnost od 24. 11. 2025 a ukončení 2.9 v září 2026. Nová struktura LV „NTŘ“ je na stejné stránce stále označena jako koncept aktualizovaný 16. 4. 2026; verze transportu a verze sestavy nejsou totéž. [ČÚZK WSDP, aktualizace stránky 24. 4. 2026](https://www.cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Dalkovy-pristup/Webove-sluzby-dalkoveho-pristupu.aspx)

Úplný výpis LV zahrnuje vlastníky/oprávněné, nemovitosti a evidované právní vztahy; „Přehled vlastnictví s nemovitostmi“ poskytuje seznam LV a jejich nemovitostí pro subjekt. Je nutné rozlišovat úplný výpis, zjednodušený/částečný výpis a přehled. Importovaný JSON aplikace není elektronická veřejná listina; tu ČÚZK popisuje u příslušného elektronicky označeného PDF. [Oficiální popis sestav](https://www.cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Dalkovy-pristup/Vystupy-z-KN-poskytovane-prostrednictvim-DP.aspx)

### Konkrétní kontrakt a nákupní hranice

V balíku 3.1 byly ověřeny `sestavy_v3_1.wsdl/.xsd` a `VypisZKatastruNemovitosti.xsd`. Operace `generujLV` přijímá `lvId`, volitelné `datumK`, `format` a volitelnou `verze`; vrací `reportList`. `seznamSestav` umožňuje zjistit stav a cenu. **`vratSestavu(idSestavy)` účtuje dosud nezaplacenou sestavu** a vrací obsah, přenos příloh používá MTOM. Report nese ID, cenu, měrné jednotky, formát, verzi a stav. Pro dávkové vytváření dokumentace požaduje rozestup alespoň dvě sekundy. `datumK` má být alespoň 20 minut v minulosti; pro aktuální stav se vynechává. [WSDP 3.1, balík z 13. 2. 2026, kapitola 3.9 a přiložená schémata](https://www.cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Dalkovy-pristup/Webove-sluzby-dalkoveho-pristupu/WSDP_10_3_1_20260213.aspx)

Veřejně ověřený [trial WSDL 3.1](https://wsdptrial.cuzk.gov.cz/trial/dokumentace/ws3_1/wsdp/sestavy_v3_1.wsdl) uvádí endpoint `https://wsdptrial.cuzk.gov.cz/trial/ws/wsdp/3.1/sestavy`. [Index XSD sestav](https://wsdptrial.cuzk.gov.cz/trial/dokumentace/xsd/sestavy/) odděleně publikuje schémata výpisu LV, informací o objektech a přehledu vlastnictví s nemovitostmi. Trial poskytuje bezplatné fiktivní/anonymizované údaje ze vzorku Prachatic a simulované účtování; nefunguje v něm objednávka listin ani HTML. [WSDP na zkoušku](https://www.cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Dalkovy-pristup/Webove-sluzby-DP-na-zkousku.aspx)

### Náklady

| XML výstup | Sazba |
| --- | ---: |
| Výpis KN | 100 Kč / LV |
| Informace o parcele, stavbě, jednotce nebo právu stavby | 10 Kč / objekt |
| Evidence práv pro osobu; přehled vlastnictví | 150 Kč / výstup |
| Přehled vlastnictví s nemovitostmi | 200 Kč / výstup |

Sazby jsou převzaty z [aktuálně publikovaného sazebníku ČÚZK, příloha 5](https://cuzk.gov.cz/Katastr-nemovitosti/Poplatky/Uctovani-vystupu-z-KN-poskytovanych-DP-A-WSDP.aspx). PDF/HTML má jiné měrné jednotky; nelze na něj automaticky použít cenu XML. U podporovaných současných PDF/HTML+XML výstupů se podle poznámky sazebníku cena přidáním XML nezvyšuje.

Modelový výpočet pro samostatné XML LV: jednorázově 10 LV = **1 000 Kč**; měsíční aktualizace 10 LV = **12 000 Kč/rok**; denní aktualizace téhož počtu = **365 000 Kč/365 dní**. Jde o výpočet počtu nových odebíraných výpisů × sazba, nikoli nabídku ČÚZK nebo ověřené vyúčtování konkrétního účtu. Nejlevnější výchozí režim aplikace je žádné automatické placené obnovování.

### Proveditelný offline prototyp — návrh

1. Připnout lokální kopie schémat a jejich SHA-256 v manifestu. První parser podporuje jedinou výslovnou verzi úplného LV. Neznámou verzi odmítne, nepokouší se ji tiše napasovat. Z veřejných ukázek vytvořit pouze syntetické fixture se smyšlenými osobami.
2. Oddělit `WsdpTransport` od parseru. Mock transport implementuje `createLvReport`, `getReportStatus`, `downloadReport`; umí SOAP Fault, aplikační chybu, čekání, MTOM i výpadek po zaplacení. Zakázat DTD, externí entity, síťové XSD importy a neomezené přílohy.
3. Návrh výsledku: `{source, transportVersion, reportVersion, reportId, requestedAt, validAt, fetchedAt, lvId, kuCode, lvNumber, completeness, properties, holders, rights, warnings}`. Všechna dlouhá ID a podíly uchovat bezeztrátově; nevytvářet rodná čísla/jména ze zkrácených údajů. U práv zachovat typ i odkazy na objekty/osoby. Neznámé oddíly přiznat v `warnings` a neoznačovat normalizaci za úplnou.
4. Oddělený korunový rozpočet na účet/adaptér, nikoli REST čítač 500. Návrh platebního stavu: `prepared → priced → reserved → downloaded / uncertain`. Před `downloadReport` atomicky rezervovat skutečnou cenu reportu pod denním i měsíčním limitem. Chybějící cenu neinterpretovat jako nulu. Po timeoutu nevygenerovat nový výpis automaticky; dohledat původní ID a účetní stav, rezervaci držet jako nejistou.
5. Zobrazit cenu a rozsah před objednávkou. Produkční transport musí mít explicitní zapnutí, vlastní šifrované přihlašovací údaje, příjemce dat a kladný limit. Oddělit data jednotlivých účtů; do metrik/logů nezapisovat vlastníky, právní text ani přístupové údaje.

Prototyp lze dokončit bez plateb jako parser + mock smlouva. Přijetí reálné integrace následně vyžaduje trial zkoušku schématu, účtování a retry, rozhodnutí správce o rozpočtu a ověření oprávnění ke způsobu použití/šíření dat. Žádný z těchto kroků tento průzkum neprovedl.

## SSZ/OZS: události pro oprávněné účty

SSZ je dostupná osobám s příslušným právem nebo účastníkům řízení o něm, například vlastníkovi či zástavnímu věřiteli. Vyžaduje prokázání totožnosti. Webové služby jsou samostatná varianta odběru; zprávy se týkají mimo jiné plomb, vkladu, záznamu a poznámky. ČÚZK uvádí doručení nejpozději do 24 hodin po události. Není to registr k libovolnému sledování cizích nemovitostí. [Základní informace SSZ](https://cuzk.gov.cz/ssz/zakladni-informace)

Do 20 sledovaných nemovitostí je služba bezplatná; od 21 je sazba 10 Kč za **každou** nemovitost a rok. Pro WS se snižuje o 20 %. Model: 21 nemovitostí = **168 Kč/rok**, 100 = **800 Kč/rok** pouze pro WS, podle počtu uznaného poskytovatelem. Neodečítat prvních 20. [Sazebník SSZ a podmínky počítání](https://www.cuzk.gov.cz/Katastr-nemovitosti/Poplatky/Sledovani-zmen.aspx), [souhrnná příloha 9 včetně pásma zdarma](https://www.cuzk.gov.cz/getattachment/a2cdcc72-10f0-4883-8362-340502bb22aa/Seznam-poskytovanych-udaju-z-katastru-a-vyse-uplat-dle-vyhlasky-c-358-2013-Sb.aspx)

Aktuálně publikovaný popis je **SSZ 2.9**, vedle starší 2.6; nelze odvozovat verzi SSZ z verze WSDP. [Rozcestník SSZ WS](https://cuzk.gov.cz/ssz/wsssz) a veřejně načtené [produkční WSDL 2.9](https://katastr.cuzk.gov.cz/dokumentace/ws29/ozs/ozsNotifikaceWS_v29.wsdl) určují endpoint `https://ozs.cuzk.gov.cz/ws/ozs/2.9/ozs`; [trial WSDL](https://wsdptrial.cuzk.gov.cz/trial/dokumentace/ws29/ozs/ozsNotifikaceWS_v29.wsdl) odkazuje na `https://ozstrial.cuzk.gov.cz/trial/ws/ozs/2.9/ozs`.

`vratNeodebraneZpravy(opakuj="n")` potvrzuje předchozí dávku a načítá další. `opakuj="a"` opakuje předchozí dávku a ignoruje nový `maxPocet`. `vratOdebraneZpravy` umožňuje obnovu již potvrzených zpráv od ID nebo času. SSZ používá vlastní WS účet a WS-Security; změnové zprávy neobsahují obecný stav objektu před změnou. Verze 2.9 má také správu hesla a upozornění na expiraci. [SSZ 2.9, kapitoly 3.3–3.5](https://cuzk.gov.cz/Katastr-nemovitosti/Poskytovani-udaju-z-KN/Sledovani-zmen/Popis-webove-sluzby-pro-sledovani-zmen-udaju-o-nem/WS_SSZ_10_0_20231411.aspx)

### Návrh spolehlivého odběru

Jeden zamčený konzument na vzdálený účet; dvě instance nesmějí nezávisle posouvat potvrzení. Před dalším `opakuj="n"` uložit celou validovanou dávku a lokální outbox v jedné transakci. Deduplikovat podle účtu a ID zprávy, jednotlivé události uvnitř zprávy rozlišit. Po nejistém přenosu opakovat poslední dávku; po obnově zálohy doplnit i již potvrzené zprávy s překryvem od posledního trvale uloženého bodu. Nezaměňovat potvrzení příjmu ČÚZK s doručením e-mailu/Gotify uživateli.

Mock scénáře: pád před/po lokálním commitu; timeout při dalším potvrzení; duplicitní dávka; vícestránkový odběr; chyba autentizace; expirace hesla; neznámý typ události; U9 bez nástupců; obnova starší zálohy; druhá instance se stejným účtem. Při poruše pozastavit potvrzování a zachovat poslední jistý bod. Zvlášť měřit stáří nejstarší nevyřízené dávky, poslední úspěch, duplicity, retry a stav přihlašovacích údajů.

Před produkčním použitím ověřit s provozovatelem dostupné období zpětného odběru a konkrétní oprávnění účtu. Tento průzkum nepotvrdil garanci neomezené historie ani kompletní nástupnický graf. SSZ událost nesmí bez explicitního rozpočtu automaticky objednat placený výpis WSDP.
