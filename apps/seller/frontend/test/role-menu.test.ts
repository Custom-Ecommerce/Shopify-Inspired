import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SELLER_CAPABILITY_MATRIX } from "../../../../packages/auth/src/seller-capabilities";
import { MENU_ROLES, menuRole, roleSeesMenu, settingsTabsFor, type StoreRole } from "../lib/role-menu";
import { extractAccessibleStoreIds, storeRoleOf } from "../lib/dashboard-auth";

// Sprint 8 (S8-B3, D-118): the dashboard menu follows the role (the backend is what enforces). The table of the portal is compared with the capability matrix of packages/auth,
// so the two cannot drift; the proxy lets a member reach the stores they belong to; the Tax tab loads for a manager.

/** The capability each menu item needs (what the pages behind it call). The roles of MENU_ROLES must be exactly the roles that have it. */
const MENU_CAPABILITY: Record<string, string> = {
  "/": "alerts.read",
  "/products": "products.read",
  "/categories": "categories.read",
  "/media": "media.read",
  "/orders": "orders.read",
  "/inbox": "contact.read",
  "/customers": "customers.read",
  "/blocklist": "blocklist.manage",
  "/inventory": "inventory.read",
  "/returns": "returns.read",
  "/reviews": "reviews.read",
  "/abandoned-carts": "abandoned_carts.manage",
  "/discounts": "discounts.read",
  "/referrals": "referrals.read",
  "/broadcast": "broadcast.manage",
  "/blog": "content.read",
  "/pages": "content.read",
  "/analytics": "analytics.read",
  "/earnings": "earnings.read",
  "/billing": "billing.manage",
  "/store": "settings.read",
  "/domain": "settings.domain",
  "/team": "team.manage",
  "/api-keys": "api_keys.manage",
};

const ROLES: StoreRole[] = ["owner", "manager", "staff", "support"];

test("every menu item with a capability shows to exactly the roles that have that capability in the matrix (the table and the matrix cannot drift)", () => {
  for (const [href, capability] of Object.entries(MENU_CAPABILITY)) {
    const expected = ROLES.filter((role) => (SELLER_CAPABILITY_MATRIX[role] as readonly string[]).includes(capability));
    assert.deepEqual([...MENU_ROLES[href]!].sort(), expected.sort(), href + " needs " + capability);
  }
});

test("the account pages are for everyone, and every link of the sidebar has a row (a link nobody listed is hidden, not shown)", () => {
  assert.deepEqual([...MENU_ROLES["/account"]!].sort(), [...ROLES].sort());
  assert.deepEqual([...MENU_ROLES["/support"]!].sort(), [...ROLES].sort());
  const sidebar = readFileSync(join(process.cwd(), "components", "dashboard", "DashboardSidebar.tsx"), "utf8");
  const hrefs = [...sidebar.matchAll(/\{ href: "([^"]+)", label:/g)].map((match) => match[1]!);
  assert.ok(hrefs.length >= 20, String(hrefs.length));
  for (const href of hrefs) assert.ok(href in MENU_ROLES, href + " has a row in MENU_ROLES");
  for (const href of Object.keys(MENU_ROLES)) assert.ok(hrefs.includes(href), href + " is a link of the sidebar");
});

test("the owner sees every item; a manager every item but the owner-only ones (earnings, billing, domain, team, API keys, referrals); staff the order, catalog and stock items; support the customer care items", () => {
  const all = Object.keys(MENU_ROLES);
  assert.deepEqual(all.filter((href) => roleSeesMenu("owner", href)), all);
  assert.deepEqual(all.filter((href) => !roleSeesMenu("manager", href)).sort(), ["/api-keys", "/billing", "/domain", "/earnings", "/referrals", "/team"]);
  assert.deepEqual(all.filter((href) => roleSeesMenu("staff", href)).sort(), ["/", "/account", "/categories", "/inventory", "/media", "/orders", "/products", "/support"]);
  assert.deepEqual(all.filter((href) => roleSeesMenu("support", href)).sort(), ["/", "/account", "/customers", "/inbox", "/orders", "/returns", "/reviews", "/support"]);
});

test("a store without a role (an older backend) is the owner's; an unknown role, and an href nobody listed, see nothing", () => {
  assert.equal(menuRole(undefined), "owner");
  assert.equal(menuRole(null), "owner");
  assert.equal(roleSeesMenu(undefined, "/earnings"), true);
  assert.equal(menuRole("admin"), null);
  assert.equal(roleSeesMenu("admin", "/orders"), false);
  assert.equal(roleSeesMenu("", "/account"), false);
  assert.equal(roleSeesMenu("owner", "/team"), true, "the Team page (S8-B4)");
  assert.equal(roleSeesMenu("manager", "/team"), false);
  assert.equal(roleSeesMenu("manager", "/api-keys"), false);
  assert.equal(roleSeesMenu("owner", "/nope"), false);
});

test("the settings tabs: the owner all, a manager all but Payments and Fraud (so the Tax tab loads for a manager), staff and support none", () => {
  const tabs = ["profile", "delivery", "payments", "theme", "seo", "messages", "fraud", "returns", "tax"];
  assert.deepEqual(settingsTabsFor("owner", tabs), tabs);
  assert.deepEqual(settingsTabsFor(undefined, tabs), tabs);
  assert.deepEqual(settingsTabsFor("manager", tabs), ["profile", "delivery", "theme", "seo", "messages", "returns", "tax"]);
  assert.ok(settingsTabsFor("manager", tabs).includes("tax"));
  assert.deepEqual(settingsTabsFor("staff", tabs), []);
  assert.deepEqual(settingsTabsFor("support", tabs), []);
  assert.deepEqual(settingsTabsFor("admin", tabs), []);
});

test("the proxy reaches the stores the user owns AND the stores they are an active member of; the role comes from storeAccess; a stranger's store is in neither", () => {
  const user = { stores: ["a1"], storeAccess: [{ id: "a1", role: "owner" as const }, { id: "b2", role: "manager" as const }, { id: "c3", role: "support" as const }] };
  assert.deepEqual(extractAccessibleStoreIds(user as never), ["a1", "b2", "c3"]);
  assert.equal(storeRoleOf(user as never, "a1"), "owner");
  assert.equal(storeRoleOf(user as never, "b2"), "manager");
  assert.equal(storeRoleOf(user as never, "c3"), "support");
  assert.equal(storeRoleOf(user as never, "zz"), null);
  assert.deepEqual(extractAccessibleStoreIds({ stores: ["a1"] } as never), ["a1"], "an older backend without storeAccess");
  assert.deepEqual(extractAccessibleStoreIds({ stores: [], storeAccess: [{ id: "", role: "staff" }, null as never] } as never), []);
  assert.deepEqual(extractAccessibleStoreIds(null), []);
});

test("the sidebar and the settings view follow the role, and the proxy uses the accessible stores", () => {
  const sidebar = readFileSync(join(process.cwd(), "components", "dashboard", "DashboardSidebar.tsx"), "utf8");
  assert.match(sidebar, /roleSeesMenu\(activeStore\?\.role, link\.href\)/);
  const view = readFileSync(join(process.cwd(), "components", "dashboard", "settings", "StoreSettingsView.tsx"), "utf8");
  assert.match(view, /settingsTabsFor\(activeStore\?\.role/);
  assert.match(view, /visibleTabs\.map/);
  const proxy = readFileSync(join(process.cwd(), "lib", "proxy.ts"), "utf8");
  assert.match(proxy, /extractAccessibleStoreIds\(user\)/);
  assert.doesNotMatch(proxy, /extractStoreIds\(user\)/);
});

test("the SB-6 allowlist is unchanged by this batch: the portal groups still equal the backend groups, strict", async () => {
  const { SETTINGS_GROUPS } = await import("../lib/settings-groups");
  const { storeSettingsUpdateSchema } = await import("@markaz/contracts");
  const shape = (storeSettingsUpdateSchema as unknown as { shape: Record<string, unknown> }).shape;
  assert.deepEqual([...SETTINGS_GROUPS].sort(), Object.keys(shape).sort());
  const route = readFileSync(join(process.cwd(), "app", "api", "proxy", "stores", "[id]", "route.ts"), "utf8");
  assert.match(route, /bindStore:\s*false/);
});
