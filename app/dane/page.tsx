import Link from "next/link";
import { holdingCheckLabel, securitiesCapNote, securitiesValueLabel } from "@/lib/securities-exemption";
import { taxLabels, taxYear, type TaxActivity, type TaxRow } from "@/lib/tax-report";
import { getTaxReport } from "@/server/tax-report";

export const metadata = { title: "Daňové podklady | Portfolio" };

function number(value: string) {
  const [whole, fraction = ""] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return fraction ? `${grouped},${fraction}` : grouped;
}

function ReportAmount({ value }: { value: TaxRow["gross"] }) {
  return <span className="report-amount">
    <strong>{number(value.amount)} <small>{value.currency}</small></strong>
    {value.currency !== "CZK" && <small>{value.czk && value.rate
      ? `${number(value.czk)} Kč · ${value.rate.date}`
      : "Kurz chybí"}</small>}
  </span>;
}

function StatementSource({ activity }: { activity: TaxActivity }) {
  return <span className="report-source">
    {activity.importId
      ? <a href={`/api/statements/${activity.importId}/xml`}>{activity.filename}</a>
      : <a href="/ibkr-demo.xml" download>{activity.filename}</a>}
    <small>{activity.source.section} · ř. {activity.source.line}{activity.source.id && ` · ID ${activity.source.id}`}</small>
  </span>;
}

export default async function TaxPage({ searchParams }: PageProps<"/dane">) {
  const { rok } = await searchParams;
  const { report, years, isDemo } = await getTaxReport(taxYear(typeof rok === "string" ? rok : null));
  const { securities } = report;
  const flagged = report.rows.filter((row) => row.note || !row.gross.rate ||
    (row.commission && !row.commission.rate) ||
    row.lots?.some((lot) => lot.holdingCheck?.status === "historic" || !lot.gross.rate ||
      (lot.commission && !lot.commission.rate))).length;

  return (
    <main className="tax-page">
      <div className="content">
        <nav className="tax-nav" aria-label="Navigace"><Link href="/">Přehled portfolia</Link></nav>
        <section className="heading">
          <div>
            <h1>Daňové podklady</h1>
            <p>{isDemo ? "Ukázkový výpis Interactive Brokers" : "Přehled z uložených výpisů Interactive Brokers"}</p>
          </div>
          <a className="report-download" href={`/api/tax-report?year=${report.year}`}>Stáhnout CSV</a>
        </section>

        <form className="tax-filters" action="/dane">
          <label htmlFor="tax-year">Rok</label>
          <select id="tax-year" name="rok" defaultValue={report.year}>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <button type="submit" className="save-button">Zobrazit rok</button>
        </form>

        <div className="metrics tax-metrics">
          <article><span>Prodeje</span><strong>{report.rows.filter(({ activity }) => activity.kind === "SELL").length}</strong></article>
          <article><span>Dividendy</span><strong>{report.rows.filter(({ activity }) => activity.kind === "DIVIDEND").length}</strong></article>
          <article><span>Položky ke kontrole</span><strong>{flagged}</strong></article>
        </div>

        {securities && (
          <section className="panel securities-panel" aria-labelledby="securities-title">
            <header><h2 id="securities-title">Osvobození prodeje cenných papírů</h2></header>
            <div className="securities-body">
              <article>
                <h3>Hodnotový test</h3>
                <dl>
                  <div><dt>Hrubé příjmy z evidovaných prodejů</dt><dd>{securities.grossCzk === null ? "—" : `${number(securities.grossCzk)} Kč`}</dd></div>
                  <div><dt>Roční hranice</dt><dd>{number(securities.grossThresholdCzk)} Kč</dd></div>
                </dl>
                <p>{securitiesValueLabel(securities.comparison)}</p>
                {securities.missing > 0 && <p>{securities.missing} prodejů vyžaduje kontrolu částky nebo kurzu.</p>}
                <p>Pro posouzení zahrň všechny odpovídající příjmy za rok a ověř rozhodná data.</p>
              </article>
              <article>
                <h3>Časový test</h3>
                <p>Zákonná doba držby musí přesáhnout {securities.timeTestYears} roky. U přiřazených nákupů uvidíš srovnání podle dat ve výpisu.</p>
                <p>{securitiesCapNote(report.year, securities.timeTestCapCzk)}</p>
              </article>
            </div>
            <p className="securities-source"><a href={securities.source}>Pravidla pro rok {report.year} na Finanční správě</a></p>
          </section>
        )}

        <section className="panel" aria-labelledby="tax-transactions-title">
          <header>
            <h2 id="tax-transactions-title">Položky za rok {report.year}</h2>
            <p>Částky jsou z výpisu. Přepočet používá denní kurz ČNB k uvedenému datu. Přiřazené nákupy jsou návrh FIFO z dostupné historie.</p>
          </header>
          {report.rows.length ? (
            <div className="table-scroll"><table className="tax-table">
              <thead><tr><th>Datum z výpisu</th><th>Typ a instrument</th><th>Částka</th><th>Pořizovací podklady</th><th>Zdroj</th></tr></thead>
              <tbody>{report.rows.map((row) => {
                const { activity } = row;
                return <tr key={JSON.stringify([activity.importId, activity.account, activity.source.section, activity.source.line, activity.source.id])}>
                  <td>{activity.date}</td>
                  <th scope="row">{taxLabels[activity.kind]}{activity.symbol && <small className="report-subline">{activity.symbol}</small>}</th>
                  <td>
                    <ReportAmount value={row.gross} />
                    {row.commission && <span className="report-subline">Komise <ReportAmount value={row.commission} /></span>}
                  </td>
                  <td>{row.note ? <span className="report-review">{row.note}</span> : row.lots ? (
                    <details className="tax-lots">
                      <summary>{row.lots.length === 1 ? "1 přiřazený nákup" : `${row.lots.length} přiřazených nákupů`}</summary>
                      <ul>{row.lots.map((lot) => <li key={JSON.stringify([lot.purchase.importId, lot.purchase.source.id])}>
                        {lot.purchase.date} · {number(lot.quantity)} ks <ReportAmount value={lot.gross} />
                        {lot.commission && <small>Komise <ReportAmount value={lot.commission} /></small>}
                        {lot.holdingCheck && (
                          <small className="report-subline">
                            {holdingCheckLabel(lot.holdingCheck)}
                            {lot.holdingCheck.status !== "historic" && ` · výročí ${lot.holdingCheck.anniversary}`}
                          </small>
                        )}
                        <StatementSource activity={lot.purchase} />
                      </li>)}</ul>
                    </details>
                  ) : "—"}</td>
                  <td><StatementSource activity={activity} /></td>
                </tr>;
              })}</tbody>
            </table></div>
          ) : <p className="empty">Pro tento rok nejsou v evidenci žádné odpovídající položky.</p>}
        </section>

        {report.alerts.length > 0 && <section className="alert tax-alert" aria-labelledby="tax-alerts-title">
          <strong id="tax-alerts-title">Upozornění k historii importu</strong>
          <ul>{report.alerts.map((alert) => <li key={alert}>{alert}</li>)}</ul>
        </section>}
        <footer className="tax-footnote">
          Přehled vychází z dat ve výpisech. K určení nároku na osvobození, výpočtu daně a zápočtu srážek je potřeba úplná evidence.
        </footer>
      </div>
    </main>
  );
}
