import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SELLER_CAPABILITY_MATRIX } from "../../../../packages/auth/src/seller-capabilities";
import {
  MENU_CAPABILITY,
  OWNER_ACTION_CAPABILITY,
  SELLER_ROLES,
  canFixReadiness,
  canUse,
  dashboardRole,
  roleCan,
  roleSeesMenu,
  settingsTabCapability,
  settingsTabsFor,
  type OwnerAction,
} from "../lib/role-access";

// Sprint 8 (S8-B4, D-118): what the dashboard shows to a role, each role against each menu item, settings tab and owner action. The backend is what enforces.

const holds = (role: (typeof SELLER_ROLES)[number], capability: string) => (SELLER_CAPABILITY_MATRIX[role] as readonly string[]).includes(capability);
const TABS = ["profile", "delivery", "payments", "theme", "seo", "messages", "fraud", "returns", "tax"];
const OWNER_ACTIONS = Object.keys(OWNER_ACTION_CAPABILITY) as OwnerAction[];
const read = (path: string) => readFileSync(join(process.cwd(), ...path.split("/")), "utf8");

test("each role x each menu item: shown exactly when the matrix gives the role the item's capability (account pages: every role)", () => {
  for (const role of SELLER_ROLES) {
    for (const [href, capability] of Object.entries(MENU_CAPABILITY)) {
      assert.equal(roleSeesMenu(role, href), capability === null ? true : holds(role, capability), role + " " + href);
    }
  }
});

test("each role x each settings tab: opened exactly with the capability that saves it", () => {
  for (const role of SELLER_ROLES) {
    for (const tab of TABS) assert.equal(settingsTabsFor(role, TABS).includes(tab), holds(role, settingsTabCapability(tab)), role + " " + tab);
  }
  assert.equal(settingsTabCapability("payments"), "settings.payments");
  assert.equal(settingsTabCapability("fraud"), "settings.fraud");
  assert.equal(settingsTabCapability("profile"), "settings.write");
});

test("each role x each owner action: billing, domain, payments, fraud, go-live, team, API keys, earnings and payouts are the owner's alone", () => {
  assert.deepEqual(OWNER_ACTIONS.sort(), ["apiKeys", "billing", "domain", "earnings", "fraud", "goLive", "payments", "payouts", "team"]);
  for (const action of OWNER_ACTIONS) {
    assert.equal(canUse("owner", action), true, "owner " + action);
    for (const role of ["manager", "staff", "support"]) assert.equal(canUse(role, action), false, role + " " + action);
    assert.equal(canUse("admin", action), false, "an unknown role " + action);
    assert.equal(canUse(undefined, action), true, "an older backend without roles is the owner " + action);
  }
});

test("an unknown role can do nothing and sees nothing", () => {
  assert.equal(dashboardRole("admin"), null);
  assert.equal(dashboardRole(""), null);
  assert.equal(roleCan("admin", "orders.read"), false);
  for (const href of Object.keys(MENU_CAPABILITY)) assert.equal(roleSeesMenu("admin", href), false, href);
  assert.deepEqual(settingsTabsFor("admin", TABS), []);
});

test("the checklist offers a fix only where the role can make it", () => {
  for (const tab of ["payments", "domain", "payout", "delivery", "profile", "products", "inventory", "account"]) assert.equal(canFixReadiness("owner", tab), true, tab);
  for (const tab of ["payments", "domain", "payout"]) assert.equal(canFixReadiness("manager", tab), false, tab);
  for (const tab of ["delivery", "profile", "products", "inventory", "account"]) assert.equal(canFixReadiness("manager", tab), true, tab);
  for (const tab of ["payments", "domain", "payout", "delivery", "profile"]) assert.equal(canFixReadiness("support", tab), false, tab);
});

test("the dashboard asks the helper before it shows an owner-only button, tile or page", () => {
  const places: Array<[string, RegExp]> = [
    ["app/(dashboard)/s/[storeId]/page.tsx", /canUse\([^)]*"earnings"\)/],
    ["app/(dashboard)/s/[storeId]/layout.tsx", /canUse\([^)]*"billing"\)/],
    ["app/(dashboard)/s/[storeId]/team/page.tsx", /canUse\([^)]*"team"\)/],
    ["app/(dashboard)/s/[storeId]/api-keys/page.tsx", /canUse\([^)]*"apiKeys"\)/],
    ["components/dashboard/OnboardingChecklist.tsx", /canUse\([^)]*"goLive"\)/],
    ["components/dashboard/PlanBanner.tsx", /canUse\([^)]*"billing"\)/],
  ];
  for (const [file, pattern] of places) assert.match(read(file), pattern, file);
});
