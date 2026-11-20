"use client";

import { createTRPCClient, httpLink } from "@trpc/client";
import { Activity, ArrowDownUp, BriefcaseBusiness, CircleCheck, FileText, LayoutGrid, Upload, Wallet } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import type { AppRouter } from "@/server/router";
import { maxStatementBytes, type Activity as StatementActivity, type Source, type StatementPreview } from "@/lib/import-types";

const api = createTRPCClient<AppRouter>({ links: [httpLink({ url: "/api/trpc" })] });
const dateFormat = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeZone: "UTC" });
const activityLabels: Record<StatementActivity["kind"], string> = {
  BUY: "Nákup",
  SELL: "Prodej",
  DIVIDEND: "Dividenda",
  DIVIDEND_SUBSTITUTE: "Náhrada dividendy",
  WITHHOLDING: "Srážková daň",
  DEPOSIT: "Vklad",
  WITHDRAWAL: "Výběr",
  INTEREST_RECEIVED: "Přijatý úrok",
  INTEREST_PAID: "Zaplacený úrok",
  FEE: "Poplatek",
  OTHER: "Jiný pohyb",
};

function displayDate(date: string) {
  return dateFormat.format(new Date(date));
}

function displayDecimal(value: string, minimumDecimals = 0) {
  const [whole, fraction = ""] = value.split(".");
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  const decimals = fraction.padEnd(minimumDecimals, "0");
  return decimals ? `${formattedWhole},${decimals}` : formattedWhole;
}

function sourceLabel(source: Source) {
  return `${source.section} · ř. ${source.line}${source.id ? ` · ID ${source.id}` : ""}`;
}

function Money({ value, currency }: { value: string; currency: string }) {
  return <span className="money">{displayDecimal(value, 2)} <small>{currency}</small></span>;
}

export function Portfolio({ initialPreview }: { initialPreview: StatementPreview }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(initialPreview);
  const [filename, setFilename] = useState("ibkr-demo.xml");
  const [isDemo, setIsDemo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState(initialPreview.accounts[0].id);
  const selected = preview.accounts.find(({ id }) => id === account) ?? preview.accounts[0];
  const positions = preview.positions.filter((row) => row.account === selected.id);
  const cash = preview.cash.filter((row) => row.account === selected.id);
  const activities = preview.activities.filter((row) => row.account === selected.id).sort((a, b) => b.date.localeCompare(a.date));
  const matching = cash.filter(({ difference }) => difference === "0").length;

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    if (file.size > maxStatementBytes) {
      setError("Vyber XML soubor do 2 MB.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.previewStatement.mutate({ xml: await file.text() });
      setPreview(result);
      setAccount(result.accounts[0].id);
      setFilename(file.name);
      setIsDemo(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Výpis se nepodařilo načíst.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#prehled">
          <span className="brand-icon"><Activity size={20} aria-hidden="true" /></span>
          <span>Portfolio</span>
        </a>
        <nav aria-label="Navigace">
          <a href="#prehled"><LayoutGrid size={17} aria-hidden="true" /> Přehled</a>
          <a href="#pozice"><BriefcaseBusiness size={17} aria-hidden="true" /> Pozice</a>
          <a href="#hotovost"><Wallet size={17} aria-hidden="true" /> Hotovost</a>
          <a href="#transakce"><ArrowDownUp size={17} aria-hidden="true" /> Transakce</a>
        </nav>
      </aside>

      <main id="prehled">
        <header className="topbar">
          <span>Přehled</span>
          <span className="environment"><span /> Lokální prototyp</span>
        </header>
        <div className="content">
          <section className="heading">
            <div>
              <h1>Přehled portfolia</h1>
              <p>Import a kontrola výpisu z Interactive Brokers</p>
            </div>
            <div className="import-actions">
              <input ref={fileInput} type="file" accept=".xml,application/xml,text/xml" onChange={loadFile} hidden />
              <button type="button" disabled={loading} onClick={() => fileInput.current?.click()}>
                <Upload size={17} aria-hidden="true" />
                {loading ? "Načítám výpis…" : "Nahrát výpis"}
              </button>
            </div>
          </section>
          {error && <div className="alert" role="alert">{error}</div>}

          <section className="statement" aria-label="Načtený výpis" aria-live="polite">
            <span className="file-icon"><FileText size={21} aria-hidden="true" /></span>
            <div className="statement-file">
              <strong>{isDemo ? "Ukázkový výpis" : filename}</strong>
              <span>{displayDate(selected.from)} – {displayDate(selected.to)}</span>
            </div>
            {preview.accounts.length > 1
              ? <label className="account">Účet <select value={account} onChange={(event) => setAccount(event.target.value)}>
                {preview.accounts.map(({ id }) => <option key={id} value={id}>{id}</option>)}
              </select></label>
              : <span className="account">Účet <strong>{selected.id}</strong></span>}
          </section>

          {preview.issues.length > 0 && (
            <section className="alert" aria-labelledby="issues-title">
              <strong id="issues-title">Výpis vyžaduje kontrolu</strong>
              <ul>{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
            </section>
          )}

          <div className="metrics">
            <article><span><BriefcaseBusiness size={16} aria-hidden="true" /> Otevřené pozice</span><strong>{positions.length}</strong></article>
            <article><span><ArrowDownUp size={16} aria-hidden="true" /> Načtené transakce</span><strong>{activities.length}</strong></article>
            <article><span><CircleCheck size={16} aria-hidden="true" /> Hotovost bez rozdílu</span><strong>{matching} <small>/ {cash.length} měn</small></strong></article>
          </div>

          <div className="overview">
            <section className="panel" id="pozice">
              <header><h2>Otevřené pozice</h2><p>Stav a ocenění k datu výpisu</p></header>
              {positions.length === 0 ? <p className="empty">Ve výpisu nejsou dostupné žádné souhrnné pozice.</p> : (
                <div className="table-scroll"><table>
                  <thead><tr><th>Instrument</th><th>Množství</th><th>Hodnota</th></tr></thead>
                  <tbody>{positions.map((row) => <tr key={row.source.line + "-" + row.source.id}>
                    <th scope="row">{row.symbol}</th>
                    <td>{displayDecimal(row.quantity)}</td>
                    <td><Money value={row.value} currency={row.currency} /></td>
                  </tr>)}</tbody>
                </table></div>
              )}
            </section>
            <section className="panel" id="hotovost">
              <header><h2>Kontrola hotovosti</h2><p>Vypočtený zůstatek proti výpisu</p></header>
              {cash.length === 0 ? <p className="empty">Ve výpisu nejsou dostupné zůstatky po měnách.</p> : (
                <div className="table-scroll"><table>
                  <thead><tr><th>Měna</th><th>Zůstatek</th><th>Rozdíl</th></tr></thead>
                  <tbody>{cash.map((row) => <tr key={row.currency}>
                    <th scope="row">{row.currency}</th>
                    <td title={row.calculated === undefined ? undefined : `Vypočteno ${displayDecimal(row.calculated, 2)} ${row.currency}`}>
                      {displayDecimal(row.closing, 2)}
                    </td>
                    <td>{row.difference === "0"
                      ? <span className="matched"><CircleCheck size={15} aria-hidden="true" /> Souhlasí</span>
                      : row.difference === undefined ? "Nelze ověřit" : displayDecimal(row.difference, 2)}</td>
                  </tr>)}</tbody>
                </table></div>
              )}
            </section>
          </div>

          <section className="panel" id="transakce">
            <header><h2>Transakce ve výpisu</h2><p>Ke každé položce je uvedený zdrojový řádek XML.</p></header>
            {activities.length === 0 ? <p className="empty">V tomto období nejsou dostupné žádné transakce.</p> : (
              <div className="table-scroll"><table className="transactions">
                <thead><tr><th>Datum</th><th>Typ</th><th>Instrument</th><th>Částka</th><th>Zdroj</th></tr></thead>
                <tbody>{activities.map((row, index) => <tr key={index}>
                  <td>{displayDate(row.date)}</td>
                  <td><strong>{row.kind === "OTHER" && row.originalType ? row.originalType : activityLabels[row.kind]}</strong></td>
                  <td>{row.symbol || "—"}</td>
                  <td><Money value={row.amount} currency={row.currency} />
                    {row.commission && <small className="commission">Komise <Money value={row.commission.amount} currency={row.commission.currency} /></small>}
                  </td>
                  <td className="source">{sourceLabel(row.source)}</td>
                </tr>)}</tbody>
              </table></div>
            )}
          </section>
          <footer><a href="/ibkr-demo.xml" download>Stáhnout ukázkové XML</a>
            {!isDemo && <button className="text-button" onClick={() => {
              setPreview(initialPreview);
              setFilename("ibkr-demo.xml");
              setAccount(initialPreview.accounts[0].id);
              setIsDemo(true);
              setError("");
            }} disabled={loading}>Zobrazit ukázku</button>}
          </footer>
        </div>
      </main>
    </div>
  );
}
