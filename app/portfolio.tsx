"use client";

import { createTRPCClient, httpLink } from "@trpc/client";
import { Activity, ArrowDownUp, BriefcaseBusiness, CircleCheck, FileText, LayoutGrid, Upload, Wallet } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { AppRouter } from "@/server/router";
import {
  maxStatementBytes,
  type Activity as StatementActivity,
  type SavedStatement,
  type Source,
  type StatementHistory,
  type StatementPreview,
} from "@/lib/import-types";

const api = createTRPCClient<AppRouter>({ links: [httpLink({ url: "/api/trpc" })] });
const dateFormat = new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeZone: "UTC" });
const savedDateFormat = new Intl.DateTimeFormat("cs-CZ", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Prague",
});
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

type StatementView =
  | { kind: "demo"; preview: StatementPreview }
  | { kind: "upload"; preview: StatementPreview; xml: string; filename: string }
  | { kind: "saved"; preview: StatementPreview; statement: SavedStatement };

export function Portfolio({ initialPreview, initialHistory, accountControls }: {
  initialPreview: StatementPreview;
  initialHistory: StatementHistory | null;
  accountControls: ReactNode;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<StatementView>({ kind: "demo", preview: initialPreview });
  const [history, setHistory] = useState(initialHistory);
  const [pending, setPending] = useState<"upload" | "save" | "open" | "history" | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [account, setAccount] = useState(initialPreview.accounts[0].id);
  const { preview } = view;
  const selected = preview.accounts.find(({ id }) => id === account) ?? preview.accounts[0];
  const positions = preview.positions.filter((row) => row.account === selected.id);
  const cash = preview.cash.filter((row) => row.account === selected.id);
  const activities = preview.activities.filter((row) => row.account === selected.id).sort((a, b) => b.date.localeCompare(a.date));
  const matching = cash.filter(({ difference }) => difference === "0").length;

  function show(next: StatementView) {
    setAccount(next.preview.accounts[0].id);
    setView(next);
  }

  async function run(operation: NonNullable<typeof pending>, action: () => Promise<void>) {
    setError("");
    setStatus("");
    setPending(operation);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "S výpisem se nepodařilo pracovat.");
    } finally {
      setPending(null);
    }
  }

  function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > maxStatementBytes) {
      setStatus("");
      setError("Vyber XML soubor do 2 MB.");
      return;
    }
    void run("upload", async () => {
      const buffer = await file.arrayBuffer();
      let xml: string;
      try {
        xml = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
      } catch {
        throw new Error("Výpis musí být XML v kódování UTF-8.");
      }
      const result = await api.previewStatement.mutate({ xml });
      show({ kind: "upload", preview: result, xml, filename: file.name });
    });
  }

  function save() {
    if (view.kind !== "upload") return;
    const { filename, xml, preview } = view;
    void run("save", async () => {
      const saved = await api.saveStatement.mutate({ filename, xml });
      setView({ kind: "saved", statement: saved.statement, preview });
      if (saved.created) {
        setHistory((current) => current ? {
          ...current,
          statements: [saved.statement, ...current.statements.filter(({ id }) => id !== saved.statement.id)],
        } : current);
      }
      setStatus(saved.created ? "Výpis byl uložen do historie." : "Tento výpis už máš uložený.");
    });
  }

  function open(id: string) {
    void run("open", async () => {
      const result = await api.getStatement.query({ id });
      show({ kind: "saved", ...result });
      setStatus(`Otevřen výpis ${result.statement.filename}.`);
    });
  }

  function more() {
    if (!history?.next) return;
    const olderThan = history.next;
    void run("history", async () => {
      const page = await api.listStatements.query({ olderThan });
      setHistory((current) => current ? {
        next: page.next,
        statements: [...current.statements, ...page.statements],
      } : current);
    });
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
          {history && <a href="#historie"><FileText size={17} aria-hidden="true" /> Historie výpisů</a>}
          <a href="#pozice"><BriefcaseBusiness size={17} aria-hidden="true" /> Pozice</a>
          <a href="#hotovost"><Wallet size={17} aria-hidden="true" /> Hotovost</a>
          <a href="#transakce"><ArrowDownUp size={17} aria-hidden="true" /> Transakce</a>
        </nav>
      </aside>

      <main id="prehled">
        <header className="topbar">
          <span>Přehled</span>
          {accountControls}
        </header>
        <div className="content">
          <section className="heading">
            <div>
              <h1>Přehled portfolia</h1>
              <p>Import a kontrola výpisu z Interactive Brokers</p>
            </div>
            <div className="import-actions">
              <input ref={fileInput} type="file" accept=".xml,application/xml,text/xml" onChange={loadFile} hidden />
              <button type="button" disabled={Boolean(pending)} onClick={() => fileInput.current?.click()}>
                <Upload size={17} aria-hidden="true" />
                {pending === "upload" ? "Načítám výpis…" : "Nahrát výpis"}
              </button>
            </div>
          </section>
          {error && <div className="alert" role="alert">{error}</div>}
          {status && <p className="notice" role="status">{status}</p>}

          {history && (
            <section className="panel import-history" id="historie" aria-labelledby="history-title">
              <header><h2 id="history-title">Uložené výpisy</h2></header>
              {history.statements.length ? (
                <ul>
                  {history.statements.map((statement) => (
                    <li key={statement.id}>
                      <button type="button" className="text-button" disabled={Boolean(pending)}
                        aria-current={view.kind === "saved" && view.statement.id === statement.id ? "true" : undefined}
                        onClick={() => open(statement.id)}>{statement.filename}</button>
                      <time dateTime={statement.savedAt}>{savedDateFormat.format(new Date(statement.savedAt))}</time>
                    </li>
                  ))}
                </ul>
              ) : <p className="empty">Tady najdeš výpisy, které uložíš po nahrání.</p>}
              {history.next && <button type="button" className="text-button import-history-more" disabled={Boolean(pending)}
                onClick={more}>{pending === "history" ? "Načítám…" : "Načíst starší výpisy"}</button>}
            </section>
          )}

          <section className="statement" aria-label="Načtený výpis" aria-live="polite">
            <span className="file-icon"><FileText size={21} aria-hidden="true" /></span>
            <div className="statement-file">
              <strong>{view.kind === "demo" ? "Ukázkový výpis" : view.kind === "saved" ? view.statement.filename : view.filename}</strong>
              <span>{displayDate(selected.from)} – {displayDate(selected.to)}</span>
              {view.kind === "upload" && !history && <span className="temporary">Dočasný náhled</span>}
            </div>
            {preview.accounts.length > 1
              ? <label className="account">Účet <select value={account} onChange={(event) => setAccount(event.target.value)}>
                {preview.accounts.map(({ id }) => <option key={id} value={id}>{id}</option>)}
              </select></label>
              : <span className="account">Účet <strong>{selected.id}</strong></span>}
            {view.kind === "upload" && history && (
              <button className="save-button" type="button" disabled={Boolean(pending)} onClick={save}>
                {pending === "save" ? "Ukládám…" : "Uložit výpis"}
              </button>
            )}
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
            {view.kind === "saved" && <a href={`/api/statements/${view.statement.id}/xml`}>Stáhnout původní XML</a>}
            {view.kind !== "demo" && <button type="button" className="text-button" onClick={() => {
              show({ kind: "demo", preview: initialPreview });
              setError("");
              setStatus("");
            }} disabled={Boolean(pending)}>Zobrazit ukázku</button>}
          </footer>
        </div>
      </main>
    </div>
  );
}
