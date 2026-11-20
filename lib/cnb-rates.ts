export type CnbRate = { date: string; amount: string; units: string };

type DailyRates = { date: string; currencies: Map<string, CnbRate> };

export function parseCnbArchive(text: string): DailyRates[] {
  let columns: ({ currency: string; units: string } | undefined)[] = [];
  const days: DailyRates[] = [];

  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [first, ...cells] = line.trim().split("|");
    if (first === "Datum") {
      columns = cells.map((label) => {
        const found = /^([1-9]\d*) ([A-Z]{3})$/.exec(label.trim());
        return found ? { currency: found[2], units: found[1] } : undefined;
      });
      continue;
    }
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(first);
    if (!match || cells.length !== columns.length) continue;
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    const currencies = new Map<string, CnbRate>();
    for (const [index, column] of columns.entries()) {
      const amount = cells[index].trim().replace(",", ".");
      if (!column || !/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) continue;
      currencies.set(column.currency, { date, amount, units: column.units });
    }
    days.push({ date, currencies });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

export function cnbRateAt(days: DailyRates[], date: string, currency: string): CnbRate | undefined {
  if (currency === "CZK") return { date, amount: "1", units: "1" };

  // ČNB's most recent publication date applies on days without a new fixing.
  const day = days.findLast((entry) => entry.date <= date);
  return day?.currencies.get(currency);
}
