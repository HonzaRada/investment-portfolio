# Portfolio

Prototyp pro import a kontrolu výpisů Interactive Brokers. Pracovní název repozitáře je `portfolio-app`.

## Spuštění

Vyžaduje Node.js 24 a npm.

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

Otevři [localhost:3000](http://localhost:3000). Úvodní obrazovka používá syntetický XML výpis, který jde stáhnout v aplikaci. **Nahrát výpis** zobrazí dočasný náhled vlastního XML i bez konfigurace databáze.

## Přihlášení a ukládání

1. Připrav PostgreSQL databázi pro aplikaci. Zkopíruj `.env.example` do `.env.local` a nastav `DATABASE_URL` na její připojovací adresu.
2. V GitHubu vytvoř [OAuth App](https://authjs.dev/guides/configuring-github) s domovskou adresou `http://localhost:3000` a callbackem `http://localhost:3000/api/auth/callback/github`. Vyplň `AUTH_GITHUB_ID` a `AUTH_GITHUB_SECRET`. `AUTH_URL` má odpovídat adrese, kterou otevíráš v prohlížeči.
3. Vygeneruj `AUTH_SECRET` příkazem `openssl rand -hex 32`, ulož ho do `.env.local` a spusť `npm run db:migrate`. Restartuj vývojový server.

Po přihlášení a nahrání XML potvrď **Uložit výpis**. Výpis najdeš v osobní historii, kde můžeš otevřít dřívější náhled a stáhnout původní XML. Účet, historie, náhled uloženého výpisu i jeho originál jsou přístupné pouze přihlášenému vlastníkovi.

## Výpis IBKR

V klientském portálu vytvoř **Activity Flex Query** ve formátu XML. Aplikace přijímá UTF-8. Zahrň **Trades** na úrovni **Execution**, **Cash Transactions** na úrovni **Detail**, **Cash Report** po jednotlivých měnách a **Open Positions** na úrovni **Summary**. Zahrň identifikátory obchodu a transakce, měnu, přesné množství, peněžní částky, komisi a čistý peněžní dopad obchodu. Importér používá formát popsaný v [IBKR Reporting Guide](https://www.ibkrguides.com/reportingreference/reportguide/activity%20flex%20query%20reference.htm).

Hodnota pozic je převzatá z výpisu. Hotovost se porovnává po měnách jako počáteční stav plus načtené čisté peněžní pohyby. Při neúplném vstupu nebo některých nepodporovaných operacích aplikace označí kontrolu jako neproveditelnou. Částky zůstávají v původní měně.

Opakované uložení stejného XML otevře stávající výpis. Překrývající se výpisy mají vlastní náhled a sdílí jednu evidenční položku pro každý účet a stabilní identifikátor transakce. Pokud stejný identifikátor přijde s odlišnými údaji, uložení skončí hlášením o konfliktu a žádná část importu se nezapíše. Řádky bez stabilního ID jsou dohledatelné v uloženém výpisu.

## Kontroly

```sh
npm test
npm run typecheck
npm run build
```

Integrační test `npm run test:storage` používá běžící aplikaci a samostatnou migrovanou databázi. Nastav `PORTFOLIO_TEST_ORIGIN` na adresu aplikace a `PORTFOLIO_TEST_DATABASE_URL` na stejnou testovací databázi jako `DATABASE_URL` v aplikaci. Test zakládá a uklízí vlastní syntetické uživatele a databázové relace.

## Rozsah

Next.js, TypeScript, tRPC, Auth.js a PostgreSQL s Drizzle. Import je zatím ověřený na syntetických výpisech IBKR. Roční podklady pro české daňové rezidenty a import rozšířených událostí pro opce a krypto jsou plánované.
