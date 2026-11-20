import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { previewIbkr } from "@/lib/ibkr";
import { authentication } from "@/server/auth";
import { listStatements } from "@/server/statement-store";
import { signInWithGitHub, signOut } from "./account-actions";
import { Portfolio } from "./portfolio";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [demo, session] = await Promise.all([
    readFile(join(process.cwd(), "public", "ibkr-demo.xml"), "utf8"),
    authentication?.auth(),
  ]);
  const history = session?.user.id ? await listStatements(session.user.id) : null;
  const accountControls = session?.user.id ? (
    <form action={signOut} className="account-controls">
      <span>{session.user.name || session.user.email || "Přihlášený účet"}</span>
      <button type="submit">Odhlásit se</button>
    </form>
  ) : authentication ? (
    <form action={signInWithGitHub} className="account-controls">
      <button type="submit">Přihlásit přes GitHub</button>
    </form>
  ) : <span className="environment"><span /> Lokální prototyp</span>;

  return <Portfolio key={session?.user.id ?? "guest"} initialPreview={previewIbkr(demo)} initialHistory={history} accountControls={accountControls} />;
}
