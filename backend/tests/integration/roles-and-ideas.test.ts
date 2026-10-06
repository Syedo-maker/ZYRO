/**
 * Issue 1 (AI product suggestions grounded in real trending keywords) and Issue 2 (separate
 * shopper and owner experiences), end to end on real Postgres, MongoDB and Redis, with a fake AI
 * provider standing in for the call to Anthropic.
 *
 * The properties this file exists to prove:
 *
 * - **A shopper is a shopper on the server, not just in the browser.** Hiding a menu item proves
 *   nothing; these checks call the owner's endpoints directly with a shopper's own valid token.
 * - **One press of "Suggest" is one AI call and one generation**, however many suggestions come back.
 * - **The suggestions cannot carry an invented trend**: a keyword is only attributed when it came
 *   from our own data and is really in the text.
 * - **The public directory shows only public things**, respects the owner's opt-out, and leaves out
 *   shops with no real catalogue.
 * - **The search log keeps nothing personal** and, per shop, cannot be read back out of the
 *   cross-shop keyword list.
 */
import request from "supertest";
import type { Express } from "express";
import { createCheckRecorder, snapshotEnv } from "../helpers/checks";

// Taken BEFORE anything below is changed, and put back in afterAll, so this file's isolated queue
// and its switched-off AI cache never leak into whichever suite jest runs next.
const restoreEnv = snapshotEnv();

process.env.RATE_LIMIT_ENABLED = "false";
process.env.AI_CACHE_SECONDS = "0";
// An isolated BullMQ queue, so this suite's fake provider answers its own jobs even if a real
// backend is running against the same Redis (see the comment on AI_QUEUE_NAME in lib/aiQueue.ts).
process.env.AI_QUEUE_NAME = `ai-generate-verify-ri-${Date.now().toString(36)}`;

let app: Express;
let prismaUnscoped: typeof import("../../src/lib/prisma").prismaUnscoped;
let Product: typeof import("../../src/models/Product.model").Product;

const suffix = Date.now().toString(36);
const created = { tenantIds: [] as string[], userIds: [] as string[] };
const { check, run, declare } = createCheckRecorder();

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  let req = (request(app) as any)[method.toLowerCase()](`/api/v1${path}`).set("Content-Type", "application/json");
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body === undefined ? req : req.send(JSON.stringify(opts.body)));
  return { status: res.status as number, json: res.body };
}

beforeAll(async () => {
  ({ app } = await import("../../src/app"));
  ({ prismaUnscoped } = await import("../../src/lib/prisma"));
  ({ Product } = await import("../../src/models/Product.model"));
  await (await import("../../src/lib/mongo")).connectMongo();
  const { setAiProvider } = await import("../../src/lib/aiProvider");
  const { startAiWorker } = await import("../../src/lib/aiQueue");
  startAiWorker();
  const { setKeywordSources } = await import("../../src/modules/ideas/keywords.sources");

  await run(async () => {
    async function merchant(tag: string) {
      const email = `verify-ri-${tag}-${suffix}@example.com`;
      const reg = await api("POST", "/auth/register", {
        body: { email, password: "password123", storeName: `Verify ${tag}`, storeSlug: `verify-ri-${tag}-${suffix}`, currency: "PKR" },
      });
      if (reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
      const storeId = (await api("GET", "/users/me/stores", { token: reg.json.accessToken })).json[0].id as string;
      created.tenantIds.push(storeId);
      created.userIds.push(reg.json.user.id);
      return { token: reg.json.accessToken as string, storeId, userId: reg.json.user.id as string, email };
    }

    async function shopper(tag: string) {
      const email = `verify-ri-shopper-${tag}-${suffix}@example.com`;
      const reg = await api("POST", "/auth/register-customer", { body: { email, password: "password123" } });
      if (reg.status !== 201) throw new Error(`register-customer ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
      created.userIds.push(reg.json.user.id);
      return { token: reg.json.accessToken as string, userId: reg.json.user.id as string, email };
    }

    const addProduct = async (owner: { token: string; storeId: string }, title: string, category = "clothing") =>
      (await api("POST", `/stores/${owner.storeId}/products`, { token: owner.token, body: { title, price: 1200, stock: 10, category } })).json.id as string;

    // ---- Issue 2: a shopper has an account, and no shop ----------------------------------------

    const owner = await merchant("owner");
    const buyer = await shopper("a");

    const myStores = await api("GET", "/users/me/stores", { token: buyer.token });
    check("a shopper's account belongs to no shop at all", myStores.status === 200 && Array.isArray(myStores.json) && myStores.json.length === 0, JSON.stringify(myStores.json));

    const ownerStores = await api("GET", "/users/me/stores", { token: owner.token });
    check("an owner's account reports the shop they own, with the owner role", ownerStores.json.length === 1 && ownerStores.json[0].role === "owner");

    // The point of Issue 2: the browser hides the dashboard from a shopper, but the server is what
    // actually refuses them. Each of these is called with the shopper's own valid token.
    const refusals = await Promise.all([
      api("GET", `/stores/${owner.storeId}/orders`, { token: buyer.token }),
      api("POST", `/stores/${owner.storeId}/products`, { token: buyer.token, body: { title: "Mine now", price: 1, stock: 1, category: "clothing" } }),
      api("GET", `/stores/${owner.storeId}/analytics/summary`, { token: buyer.token }),
      api("GET", `/stores/${owner.storeId}/billing`, { token: buyer.token }),
      api("PATCH", `/stores/${owner.storeId}/branding`, { token: buyer.token, body: { name: "Renamed by a shopper" } }),
      api("POST", `/stores/${owner.storeId}/product-ideas`, { token: buyer.token, body: { category: "clothing" } }),
      api("GET", `/stores/${owner.storeId}/product-ideas/keywords`, { token: buyer.token }),
      api("GET", `/stores/${owner.storeId}/directory-listing`, { token: buyer.token }),
    ]);
    check(
      "a shopper is refused by the server on every owner endpoint, not merely shown a different menu",
      refusals.every((r) => r.status === 401 || r.status === 403),
      refusals.map((r) => r.status).join(",")
    );
    check("the shop's name was not changed by that attempt", (await api("GET", `/stores/${owner.storeId}`)).json.name === "Verify owner");

    // ---- Issue 2: the experience preference is a hint, never a permission ----------------------

    const pref = await api("PATCH", "/users/me/preference", { token: buyer.token, body: { experience: "owner" } });
    check("a shopper may say they prefer the owner experience", pref.status === 200 && pref.json.preferredExperience === "owner");
    check("saying so is remembered on their profile", (await api("GET", "/users/me", { token: buyer.token })).json.preferredExperience === "owner");

    const stillRefused = await api("GET", `/stores/${owner.storeId}/orders`, { token: buyer.token });
    check("but it grants them nothing: the owner's endpoints still refuse them", stillRefused.status === 403 || stillRefused.status === 401, String(stillRefused.status));
    check("and they still belong to no shop", (await api("GET", "/users/me/stores", { token: buyer.token })).json.length === 0);

    const badPref = await api("PATCH", "/users/me/preference", { token: buyer.token, body: { experience: "platform_admin" } });
    check("an experience that is not one of the two is refused", badPref.status === 400, String(badPref.status));

    // ---- Issue 2: the public directory ---------------------------------------------------------

    const empty = await merchant("empty");
    const listed = await merchant("listed");
    await Promise.all([addProduct(listed, "Lawn Suit Three Piece"), addProduct(listed, "Summer Lawn Kurta"), addProduct(listed, "Cotton Shalwar")]);
    await addProduct(empty, "Only One Thing");
    await api("PATCH", `/stores/${listed.storeId}/branding`, { token: listed.token, body: { description: "Lawn and cotton stitched in Faisalabad." } });

    const directory = await api("GET", "/stores");
    const find = (id: string) => (directory.json.stores as { id: string }[]).find((s) => s.id === id);
    check("the directory needs no login: a shopper with no account can read it", directory.status === 200 && Array.isArray(directory.json.stores));
    check("a shop with a real catalogue is listed", Boolean(find(listed.storeId)));
    check("a shop with too few products is left out, so empty and test shops never show", !find(empty.storeId));

    const card = find(listed.storeId) as Record<string, unknown>;
    check(
      "a directory card carries only public information",
      Object.keys(card).sort().join(",") === "category,currency,description,id,logoUrl,name,productCount,slug,themeColor",
      Object.keys(card).sort().join(",")
    );
    check("and nothing about the shop's trade or its owner", !JSON.stringify(card).match(/ownerId|plan|revenue|email|stripe|orderCounter/i));
    check("the shop's own line about itself is shown", card.description === "Lawn and cotton stitched in Faisalabad.");
    check("the category is worked out from what the shop actually sells", card.category === "clothing");

    const off = await api("PATCH", `/stores/${listed.storeId}/branding`, { token: listed.token, body: { listedInDirectory: false } });
    check("the owner can turn the listing off", off.status === 200 && off.json.listedInDirectory === false);
    check("and the shop disappears from the directory", !(await api("GET", "/stores")).json.stores.some((s: { id: string }) => s.id === listed.storeId));
    check("while the shop itself keeps working for anyone with its link", (await api("GET", `/stores/${listed.storeId}`)).status === 200);
    check(
      "the public shop profile does not leak the directory setting to shoppers",
      !("listedInDirectory" in (await api("GET", `/stores/${listed.storeId}`)).json),
      JSON.stringify((await api("GET", `/stores/${listed.storeId}`)).json)
    );

    const status = await api("GET", `/stores/${listed.storeId}/directory-listing`, { token: listed.token });
    check("the owner is told plainly that their shop is not listed, and why", status.status === 200 && status.json.listed === false && /turned the directory listing off/i.test(status.json.reason));

    const emptyStatus = await api("GET", `/stores/${empty.storeId}/directory-listing`, { token: empty.token });
    check("a shop held back for having too few products is told how many it needs", emptyStatus.json.listed === false && /3 products/.test(emptyStatus.json.reason), emptyStatus.json.reason);

    await api("PATCH", `/stores/${listed.storeId}/branding`, { token: listed.token, body: { listedInDirectory: true } });

    // ---- Issue 1: the search log keeps nothing personal ---------------------------------------

    const searches = ["lawn suit", "lawn suit", "ali@example.com", "03001234567", "+92 300 1234567", "ok", "500"];
    for (const q of searches) await api("GET", `/stores/${listed.storeId}/products?q=${encodeURIComponent(q)}&category=clothing`);
    // The write is deliberately not awaited by the search path, so give it a moment to land.
    await new Promise((r) => setTimeout(r, 400));

    const logged = await prismaUnscoped.searchTermDaily.findMany({ where: { tenantId: listed.storeId } });
    check("a real search is counted", logged.some((r) => r.term === "lawn suit"), JSON.stringify(logged.map((r) => r.term)));
    check("searching the same word twice counts twice in one row, not two rows a person could be followed through", logged.filter((r) => r.term === "lawn suit").length === 1 && logged.find((r) => r.term === "lawn suit")!.count === 2);
    check("an email address is never written to the log", !logged.some((r) => r.term.includes("@")));
    check("a phone number is never written to the log", !logged.some((r) => /\d{7}/.test(r.term.replace(/\D/g, ""))), JSON.stringify(logged.map((r) => r.term)));
    check("a term too short to mean anything is not counted", !logged.some((r) => r.term === "ok"));
    check("a bare number is not counted", !logged.some((r) => r.term === "500"));
    check(
      "a row holds only the term, the shop, the category and the day: no user, no session, no address",
      logged.every((r) => Object.keys(r).sort().join(",") === "category,count,createdAt,day,id,tenantId,term"),
      Object.keys(logged[0] ?? {}).sort().join(",")
    );
    check("the day is a date and nothing finer", logged.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day)));

    // One shop's searches must not come back out of the cross-shop keyword list, however many times
    // that shop searched. Only this shop has searched "lawn suit", and the rule needs five.
    const { shopperSearchSource } = await import("../../src/modules/ideas/keywords.sources");
    const fromOneShop = await shopperSearchSource.keywordsFor("PKR", "clothing");
    check(
      "a word only one shop has searched for is not reported to anyone",
      !fromOneShop.some((k) => k.word === "lawn suit"),
      JSON.stringify(fromOneShop.map((k) => k.word))
    );

    // ---- Issue 1: suggestions ------------------------------------------------------------------

    // A fake keyword source, so the suggestion behaviour is tested against known words rather than
    // whatever happens to be in the development database.
    setKeywordSources([
      {
        id: "test_source",
        async keywordsFor() {
          return [
            { word: "lawn suit", source: "shopper_searches", weight: 3 },
            { word: "3 piece", source: "best_sellers", weight: 2 },
            { word: "summer", source: "google_trends", weight: 1 },
          ];
        },
      },
    ]);
    const { forgetKeywords } = await import("../../src/modules/ideas/keywords.sources");
    await forgetKeywords("PKR", "clothing");

    let aiCalls = 0;
    let nextReply = JSON.stringify({
      suggestions: [
        { title: "Summer Lawn Suit, 3 Piece", description: "A light lawn suit for summer, cut as a 3 piece.", keywordsUsed: ["lawn suit", "3 piece", "summer"] },
        { title: "Stitched Lawn Suit", description: "Ready to wear lawn suit in soft cotton.", keywordsUsed: ["lawn suit"] },
        // Claims three keywords it never wrote: the server must not repeat the claim.
        { title: "Plain Kurta", description: "A simple stitched kurta.", keywordsUsed: ["lawn suit", "3 piece", "summer"] },
        { title: "Cotton Shalwar Kameez", description: "An everyday shalwar kameez for summer.", keywordsUsed: [] },
      ],
    });
    setAiProvider({
      async generate() {
        aiCalls += 1;
        return { text: nextReply, model: "fake-model-1", inputTokens: 40, outputTokens: 120 };
      },
    });

    const beforeUsage = (await api("GET", `/stores/${listed.storeId}/ai-usage`, { token: listed.token })).json;
    const ideas = await api("POST", `/stores/${listed.storeId}/product-ideas`, { token: listed.token, body: { title: "lawn suit", category: "clothing", price: 2500 } });
    const afterUsage = (await api("GET", `/stores/${listed.storeId}/ai-usage`, { token: listed.token })).json;

    check("four suggestions come back", ideas.status === 200 && ideas.json.suggestions.length === 4, JSON.stringify(ideas.json).slice(0, 300));
    check("all four came from a single AI call", aiCalls === 1, String(aiCalls));
    check(
      "and cost the shop one generation, not one per suggestion",
      afterUsage.generationsUsed - beforeUsage.generationsUsed === 1,
      `${beforeUsage.generationsUsed} -> ${afterUsage.generationsUsed}`
    );

    const [first, , overclaiming] = ideas.json.suggestions as { title: string; description: string; keywordsUsed: string[] }[];
    check("a suggestion says which popular searches it really uses", first.keywordsUsed.includes("lawn suit") && first.keywordsUsed.includes("summer"));
    check("a suggestion that claims keywords it never wrote is not allowed to say so", overclaiming.keywordsUsed.length === 0, JSON.stringify(overclaiming.keywordsUsed));
    check("the answer says trend data was available", ideas.json.trendDataAvailable === true && ideas.json.notice === null);
    check("nothing was saved: no product was created by asking for suggestions", (await api("GET", `/stores/${listed.storeId}/products`, { token: listed.token })).json.data.length === 3);

    // A category nobody has data for: the merchant is told, and still gets suggestions.
    setKeywordSources([{ id: "test_empty", async keywordsFor() { return []; } }]);
    await forgetKeywords("PKR", "beekeeping supplies");
    nextReply = JSON.stringify({ suggestions: [{ title: "Bee Smoker", description: "A steel smoker for working a hive calmly.", keywordsUsed: ["lawn suit"] }] });
    const noTrend = await api("POST", `/stores/${listed.storeId}/product-ideas`, { token: listed.token, body: { title: "smoker", category: "beekeeping supplies" } });
    check("with no trend data the merchant still gets suggestions", noTrend.status === 200 && noTrend.json.suggestions.length === 1);
    check("and is told plainly that there is no trend data for this category", noTrend.json.trendDataAvailable === false && /do not have trend data/i.test(noTrend.json.notice));
    check("a keyword cannot be attributed when there were no keywords at all", noTrend.json.suggestions[0].keywordsUsed.length === 0);

    // An unusable answer must not reach the merchant as a suggestion.
    nextReply = "I am afraid I cannot help with that.";
    const unusable = await api("POST", `/stores/${listed.storeId}/product-ideas`, { token: listed.token, body: { category: "clothing" } });
    check("an unreadable AI answer gives an empty list rather than nonsense", unusable.status === 200 && unusable.json.suggestions.length === 0);

    // Staff without PRODUCTS_WRITE are refused, like anywhere else products are written.
    const staffEmail = `verify-ri-staff-${suffix}@example.com`;
    await api("POST", `/stores/${listed.storeId}/staff`, { token: listed.token, body: { email: staffEmail, password: "password123", permissions: ["orders_write"] } });
    const staffToken = (await api("POST", "/auth/login", { body: { email: staffEmail, password: "password123" } })).json.accessToken as string;
    const staffTry = await api("POST", `/stores/${listed.storeId}/product-ideas`, { token: staffToken, body: { category: "clothing" } });
    check("a staff member who may not add products may not write listings for them either", staffTry.status === 403, String(staffTry.status));

    // A shop may not ask for suggestions using another shop's id.
    const crossShop = await api("POST", `/stores/${owner.storeId}/product-ideas`, { token: listed.token, body: { category: "clothing" } });
    check("one shop cannot spend another shop's AI allowance", crossShop.status === 403 || crossShop.status === 404, String(crossShop.status));

    setKeywordSources(undefined);
  });
}, 180_000);

afterAll(async () => {
  restoreEnv();
  (await import("../../src/lib/aiProvider")).setAiProvider(undefined);
  await (await import("../../src/lib/aiQueue")).closeAiQueue();
  (await import("../../src/modules/ideas/keywords.sources")).setKeywordSources(undefined);
  await Product.deleteMany({ storeId: { $in: created.tenantIds } });
  for (const t of created.tenantIds) await prismaUnscoped.tenant.deleteMany({ where: { id: t } });
  for (const u of created.userIds) await prismaUnscoped.user.deleteMany({ where: { id: u } });
  await (await import("../../src/lib/redis")).closeRedis();
  await (await import("mongoose")).default.disconnect();
  await prismaUnscoped.$disconnect();
});

declare([
    "a shopper's account belongs to no shop at all",
    "an owner's account reports the shop they own, with the owner role",
    "a shopper is refused by the server on every owner endpoint, not merely shown a different menu",
    "the shop's name was not changed by that attempt",
    "a shopper may say they prefer the owner experience",
    "saying so is remembered on their profile",
    "but it grants them nothing: the owner's endpoints still refuse them",
    "and they still belong to no shop",
    "an experience that is not one of the two is refused",
]);

declare([
    "the directory needs no login: a shopper with no account can read it",
    "a shop with a real catalogue is listed",
    "a shop with too few products is left out, so empty and test shops never show",
    "a directory card carries only public information",
    "and nothing about the shop's trade or its owner",
    "the shop's own line about itself is shown",
    "the category is worked out from what the shop actually sells",
    "the owner can turn the listing off",
    "and the shop disappears from the directory",
    "while the shop itself keeps working for anyone with its link",
    "the public shop profile does not leak the directory setting to shoppers",
    "the owner is told plainly that their shop is not listed, and why",
    "a shop held back for having too few products is told how many it needs",
]);

declare([
    "a real search is counted",
    "searching the same word twice counts twice in one row, not two rows a person could be followed through",
    "an email address is never written to the log",
    "a phone number is never written to the log",
    "a term too short to mean anything is not counted",
    "a bare number is not counted",
    "a row holds only the term, the shop, the category and the day: no user, no session, no address",
    "the day is a date and nothing finer",
    "a word only one shop has searched for is not reported to anyone",
]);

declare([
    "four suggestions come back",
    "all four came from a single AI call",
    "and cost the shop one generation, not one per suggestion",
    "a suggestion says which popular searches it really uses",
    "a suggestion that claims keywords it never wrote is not allowed to say so",
    "the answer says trend data was available",
    "nothing was saved: no product was created by asking for suggestions",
    "with no trend data the merchant still gets suggestions",
    "and is told plainly that there is no trend data for this category",
    "a keyword cannot be attributed when there were no keywords at all",
    "an unreadable AI answer gives an empty list rather than nonsense",
    "a staff member who may not add products may not write listings for them either",
    "one shop cannot spend another shop's AI allowance",
]);
