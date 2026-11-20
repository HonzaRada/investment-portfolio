export const maxStatementBytes = 2 * 1024 * 1024;

export type Source = {
  section: string;
  line: number;
  id?: string;
};

export type Activity = {
  account: string;
  date: string;
  kind: "BUY" | "SELL" | "DIVIDEND" | "DIVIDEND_SUBSTITUTE" | "WITHHOLDING" |
    "DEPOSIT" | "WITHDRAWAL" | "INTEREST_RECEIVED" | "INTEREST_PAID" | "FEE" | "OTHER";
  originalType?: string;
  symbol: string;
  brokerInstrumentId?: string;
  currency: string;
  amount: string;
  quantity?: string;
  commission?: { amount: string; currency: string };
  netCash?: string;
  source: Source;
};

export type Position = {
  account: string;
  symbol: string;
  currency: string;
  assetCategory: string;
  quantity: string;
  value: string;
  source: Source;
};

export type CashBalance = {
  account: string;
  currency: string;
  opening: string;
  closing: string;
  calculated?: string;
  difference?: string;
  source: Source;
};

export type StatementPreview = {
  accounts: { id: string; from: string; to: string }[];
  activities: Activity[];
  positions: Position[];
  cash: CashBalance[];
  issues: string[];
};

export type SavedStatement = { id: string; filename: string; savedAt: string };

export type StatementHistory = {
  statements: SavedStatement[];
  next?: { id: string; savedAt: string };
};
