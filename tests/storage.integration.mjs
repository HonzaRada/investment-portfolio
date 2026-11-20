import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";

const origin = process.env.PORTFOLIO_TEST_ORIGIN;
const database = process.env.PORTFOLIO_TEST_DATABASE_URL;

test("private statement history preserves original XML, deduplicates events and rolls back conflicts", async () => {
  assert.ok(origin && database, "Provide PORTFOLIO_TEST_ORIGIN and PORTFOLIO_TEST_DATABASE_URL.");
  const pool = new Pool({ connectionString: database });
  const userIds = [];

  async function createUser(name) {
    const email = `${randomUUID()}@portfolio-test.example`;
    const { rows: [user] } = await pool.query("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id", [name, email]);
    userIds.push(user.id);
    const token = randomUUID();
    await pool.query("INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, now() + interval '1 hour')", [token, user.id]);
    const cookie = new URL(origin).protocol === "https:" ? "__Secure-authjs.session-token" : "authjs.session-token";
    return { id: user.id, headers: { cookie: `${cookie}=${encodeURIComponent(token)}` } };
  }

  function get(path, user) {
    return fetch(new URL(path, origin), { headers: user?.headers });
  }

  function trpcQuery(name, input, user) {
    const query = new URLSearchParams({ input: JSON.stringify(input) });
    return get(`/api/trpc/${name}?${query}`, user);
  }

  function save(filename, xml, user) {
    return fetch(new URL("/api/trpc/saveStatement", origin), {
      method: "POST",
      headers: { ...user?.headers, "content-type": "application/json" },
      body: JSON.stringify({ filename, xml }),
    });
  }

  async function responseData(response) {
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body.error));
    return body.result.data;
  }

  async function activityCount(user) {
    const { rows: [row] } = await pool.query("SELECT count(*)::integer AS count FROM broker_activities WHERE user_id = $1", [user.id]);
    return row.count;
  }

  try {
    const input = await readFile(new URL("../public/ibkr-demo.xml", import.meta.url), "utf8");
    const demo = "\uFEFF" + input;
    const [owner, other] = [await createUser("Testovací účet A"), await createUser("Testovací účet B")];
    assert.equal((await get("/api/auth/providers")).status, 200);
    const home = await get("/", owner);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Uložené výpisy/);
    const session = await (await get("/api/auth/session", owner)).json();
    assert.deepEqual(Object.keys(session).sort(), ["expires", "user"]);
    assert.equal(session.user.id, owner.id);
    assert.deepEqual(Object.keys(session.user).sort(), ["email", "id", "image", "name"]);
    assert.equal((await trpcQuery("listStatements", {})).status, 401);
    assert.equal((await save("demo.xml", demo)).status, 401);
    const foreignOrigin = await fetch(new URL("/api/trpc/saveStatement", origin), {
      method: "POST",
      headers: { ...owner.headers, origin: "https://outside.example", "content-type": "application/json" },
      body: JSON.stringify({ filename: "demo.xml", xml: demo }),
    });
    assert.equal(foreignOrigin.status, 403);

    const concurrent = await Promise.all([
      save("demo.xml", demo, owner).then(responseData),
      save("demo.xml", demo, owner).then(responseData),
    ]);
    assert.equal(concurrent.filter(({ created }) => created).length, 1);
    const { id } = concurrent[0].statement;
    assert.equal(concurrent[1].statement.id, id);
    assert.equal(await activityCount(owner), 8);

    const xml = await get(`/api/statements/${id}/xml`, owner);
    assert.equal(xml.status, 200);
    assert.equal(xml.headers.get("cache-control"), "private, no-store");
    assert.match(xml.headers.get("content-disposition"), /^attachment;/);
    assert.deepEqual(Buffer.from(await xml.arrayBuffer()), Buffer.from(demo, "utf8"));
    const detail = await responseData(await trpcQuery("getStatement", { id }, owner));
    assert.equal(detail.preview.positions.length, 3);
    assert.deepEqual(Object.keys(detail.statement).sort(), ["filename", "id", "savedAt"]);

    assert.equal((await trpcQuery("getStatement", { id }, other)).status, 404);
    assert.equal((await get(`/api/statements/${id}/xml`, other)).status, 404);
    assert.equal((await get(`/api/statements/${id}/xml`)).status, 401);
    assert.deepEqual((await responseData(await trpcQuery("listStatements", {}, other))).statements, []);

    const overlapping = demo.replace("</CashTransactions>", '<CashTransaction levelOfDetail="DETAIL" transactionID="20005" dateTime="20251202" type="Dividends" symbol="AAPL" currency="USD" amount="1"/>\n</CashTransactions>')
      .replace('endingCash="2798.77"', 'endingCash="2799.77"');
    assert.equal((await responseData(await save("overlapping.xml", overlapping, owner))).created, true);
    assert.equal(await activityCount(owner), 9);

    const corrected = overlapping.replace('transactionID="20005"', 'transactionID="20006"')
      .replace('quantity="10" currency="USD"', 'quantity="11" currency="USD"');
    assert.equal((await save("corrected.xml", corrected, owner)).status, 409);
    assert.equal(await activityCount(owner), 9);
    assert.equal((await responseData(await trpcQuery("listStatements", {}, owner))).statements.length, 2);

    const separate = await responseData(await save("demo.xml", demo, other));
    assert.notEqual(separate.statement.id, id);
    assert.equal(await activityCount(other), 8);

    await Promise.all(Array.from({ length: 15 }, async (_, index) => {
      const renamedQuery = demo.replace('queryName="Ukázkové portfolio"', `queryName="Portfolio ${index}"`);
      await responseData(await save(`portfolio-${index}.xml`, renamedQuery, owner));
    }));
    const first = await responseData(await trpcQuery("listStatements", {}, owner));
    assert.equal(first.statements.length, 15);
    assert.ok(first.next);
    const second = await responseData(await trpcQuery("listStatements", { olderThan: first.next }, owner));
    assert.equal(second.statements.length, 2);
    assert.equal(second.next, undefined);
    assert.equal(new Set([...first.statements, ...second.statements].map((item) => item.id)).size, 17);
    assert.equal(await activityCount(owner), 9);
  } finally {
    try {
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
    } finally {
      await pool.end();
    }
  }
});
