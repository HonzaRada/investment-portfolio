import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { previewIbkr } from "@/lib/ibkr";
import { Portfolio } from "./portfolio";

export default async function Home() {
  const demo = await readFile(join(process.cwd(), "public", "ibkr-demo.xml"), "utf8");
  return <Portfolio initialPreview={previewIbkr(demo)} />;
}
