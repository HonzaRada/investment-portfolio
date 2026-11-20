# Portfolio

Lokální prototyp pro kontrolu výpisů Interactive Brokers. Pracovní název repozitáře je `portfolio-app`.

## Spuštění

Vyžaduje Node.js 24 a npm.

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

Otevři [localhost:3000](http://localhost:3000). Úvodní obrazovka používá syntetický XML výpis, který jde stáhnout v aplikaci. Vlastní XML výpis můžeš zkusit přes **Nahrát výpis**. Lokální proces zpracuje nezměněné XML v paměti a vrátí náhled.

## Výpis IBKR

V klientském portálu vytvoř **Activity Flex Query** v XML. Zahrň **Trades** na úrovni **Execution**, **Cash Transactions** na úrovni **Detail**, **Cash Report** po jednotlivých měnách a **Open Positions** na úrovni **Summary**. Zahrň identifikátory obchodu a transakce, měnu, přesné množství, peněžní částky, komisi a čistý peněžní dopad obchodu. Importér používá formát popsaný v [IBKR Reporting Guide](https://www.ibkrguides.com/reportingreference/reportguide/activity%20flex%20query%20reference.htm).

Hodnota pozic je převzatá z výpisu. Hotovost se porovnává po měnách jako počáteční stav plus načtené čisté peněžní pohyby. Při neúplném vstupu nebo některých nepodporovaných operacích aplikace označí kontrolu jako neproveditelnou. Částky zůstávají v původní měně. Pro opakované řádky s totožným identifikátorem kontroluje import duplicity uvnitř jednoho výpisu.

## Kontroly

```sh
npm test
npm run typecheck
npm run build
```

## Rozsah

Next.js, TypeScript a tRPC. Zatím jde o náhled jednoho nahraného výpisu a syntetická testovací data. První verzi importu je potřeba ověřit na reálných anonymizovaných exportech. Další krok je trvalá evidence v PostgreSQL s Drizzle, oddělené uživatelské účty a roční podklady pro české daňové rezidenty. Podpora rozšířených událostí pro opce a krypto se doplní podle dostupných výpisů.
