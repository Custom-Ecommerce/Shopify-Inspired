/**
 * Reserved-label registry (report §3.6, decision P1-D16/P1-D18 context).
 *
 * One list of host labels that can never be claimed as a store's branded
 * subdomain (`<slug>.${ROOT_DOMAIN}`). Consumed by:
 *   - Seller and Admin `Stores.slug` validation (via their subdomain-validation
 *     re-exports),
 *   - Admin `provision-store` slug generation,
 *   - the storefront host classifier (M4), which reads the disposition.
 *
 * Theme slugs are derived from the theme manifest, so adding a theme cannot
 * create a collision with a reserved word.
 *
 * Pure and Payload-agnostic.
 */
import { THEME_SLUGS, type ThemeSlug } from "../themes/manifest";

export const RESERVATION_CATEGORIES = [
  "infrastructure",
  "platform-surface",
  "auth-money",
  "marketing",
  "environment",
  "impersonation",
  "payment-partner",
  "theme",
] as const;
export type ReservationCategory = (typeof RESERVATION_CATEGORIES)[number];

/** What the host classifier does with a request whose single label is reserved. */
export type ReservedDisposition =
  | { readonly kind: "canonical-apex" }
  | { readonly kind: "app-redirect"; readonly target: "admin" | "seller-portal" | "api" }
  | { readonly kind: "seller-auth" }
  | { readonly kind: "marketing" }
  | { readonly kind: "theme-name"; readonly themeSlug: ThemeSlug }
  | { readonly kind: "not-found" };

export interface ReservedLabelEntry {
  readonly label: string;
  readonly category: ReservationCategory;
  readonly disposition: ReservedDisposition;
}

const NOT_FOUND: ReservedDisposition = { kind: "not-found" };
const MARKETING: ReservedDisposition = { kind: "marketing" };
const SELLER_AUTH: ReservedDisposition = { kind: "seller-auth" };
const CANONICAL_APEX: ReservedDisposition = { kind: "canonical-apex" };
const ADMIN_APP: ReservedDisposition = { kind: "app-redirect", target: "admin" };
const SELLER_APP: ReservedDisposition = { kind: "app-redirect", target: "seller-portal" };
const API_APP: ReservedDisposition = { kind: "app-redirect", target: "api" };

type StaticCategory = Exclude<ReservationCategory, "theme">;

function group(
  category: StaticCategory,
  disposition: ReservedDisposition,
  labels: readonly string[],
): ReservedLabelEntry[] {
  return labels.map((label) => ({ label, category, disposition }));
}

const STATIC_ENTRIES: readonly ReservedLabelEntry[] = [
  { label: "www", category: "infrastructure", disposition: CANONICAL_APEX },
  { label: "api", category: "infrastructure", disposition: API_APP },
  ...group(
    "infrastructure",
    NOT_FOUND,
    [
      "mail", "ftp", "cdn", "static", "assets", "media", "img", "images", "files",
      "smtp", "imap", "pop", "sftp", "ns1", "ns2", "mx", "webmail", "autodiscover",
      "vpn", "git",
    ],
  ),

  { label: "admin", category: "platform-surface", disposition: ADMIN_APP },
  ...group("platform-surface", SELLER_APP, ["seller", "dashboard", "portal"]),
  ...group(
    "platform-surface",
    MARKETING,
    [
      "app", "store", "sellers", "stores", "shop", "shops", "console", "panel",
      "manage", "merchant", "cms", "payload",
    ],
  ),

  ...group(
    "auth-money",
    SELLER_AUTH,
    [
      "login", "signin", "signup", "register", "auth", "sso", "oauth", "account",
      "accounts", "billing", "checkout", "pay", "payments", "invoices", "webhook",
      "webhooks",
    ],
  ),

  ...group(
    "marketing",
    MARKETING,
    [
      "blog", "theme", "help", "support", "docs", "status", "pricing", "features",
      "themes", "about", "contact", "careers", "jobs", "press", "partners",
      "affiliates", "community", "forum", "integrations", "news", "changelog",
      "roadmap", "compare", "security", "trust", "legal", "terms", "privacy",
      "cookies", "refunds", "sitemap", "robots",
    ],
  ),

  ...group(
    "environment",
    NOT_FOUND,
    ["dev", "test", "staging", "stage", "beta", "alpha", "demo", "preview", "sandbox", "internal", "system"],
  ),

  ...group(
    "impersonation",
    NOT_FOUND,
    [
      "markaz", "markazify", "official", "staff", "team", "root", "postmaster",
      "hostmaster", "webmaster", "abuse", "noreply", "no-reply",
    ],
  ),

  ...group("payment-partner", NOT_FOUND, ["stripe", "postex", "leopards", "tcs", "whatsapp", "easypaisa", "jazzcash"]),
];

const THEME_ENTRIES: readonly ReservedLabelEntry[] = THEME_SLUGS.map(
  (themeSlug): ReservedLabelEntry => ({
    label: themeSlug,
    category: "theme",
    disposition: { kind: "theme-name", themeSlug },
  }),
);

/** Every reserved host label with its category and disposition. */
export const RESERVED_LABEL_ENTRIES: readonly ReservedLabelEntry[] = [...STATIC_ENTRIES, ...THEME_ENTRIES];

/** Flat list of reserved labels. Kept under the legacy name for the backend re-exports. */
export const RESERVED_SUBDOMAINS: readonly string[] = RESERVED_LABEL_ENTRIES.map((entry) => entry.label);

/**
 * Path segments reserved for internal rewrite targets (report §3.5). These are
 * NOT host labels. The host classifier returns 404 for any inbound path that
 * starts with one of them.
 */
export const RESERVED_PATH_PREFIXES = ["tenant", "demo", "custom", "_internal"] as const;

const ENTRY_BY_LABEL: ReadonlyMap<string, ReservedLabelEntry> = new Map<string, ReservedLabelEntry>(
  RESERVED_LABEL_ENTRIES.map((entry): [string, ReservedLabelEntry] => [entry.label, entry]),
);

export function isReservedLabel(label: string): boolean {
  return ENTRY_BY_LABEL.has(label);
}

export function getReservedDisposition(label: string): ReservedDisposition | undefined {
  return ENTRY_BY_LABEL.get(label)?.disposition;
}

/** The one limit on a store slug. A slug is a DNS label on the storefront, so store creation, the storefront middleware and
 * the revalidate tags all read these: a slug that one accepts and another refuses is a store that answers 404. */
export const STORE_SLUG_MIN_LENGTH = 3;
export const STORE_SLUG_MAX_LENGTH = 30;
const STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const STORE_SLUG_FORMAT_MESSAGE =
  `Slug must be ${STORE_SLUG_MIN_LENGTH}-${STORE_SLUG_MAX_LENGTH} characters, lowercase letters/numbers/hyphens only, no leading or trailing hyphen.`;

export type StoreSlugCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "format" | "reserved"; readonly message: string };

/**
 * Checks a branded store slug. `allowReserved` is set only for theme-demo
 * stores (`isThemeDemo: true`), which are the one place a reserved theme name
 * is valid as a slug.
 */
export function checkStoreSlug(slug: string, options: { allowReserved?: boolean } = {}): StoreSlugCheck {
  if (
    !STORE_SLUG_PATTERN.test(slug) ||
    slug.length < STORE_SLUG_MIN_LENGTH ||
    slug.length > STORE_SLUG_MAX_LENGTH
  ) {
    return { ok: false, reason: "format", message: STORE_SLUG_FORMAT_MESSAGE };
  }
  if (!options.allowReserved && isReservedLabel(slug)) {
    return {
      ok: false,
      reason: "reserved",
      message: `"${slug}" is a reserved word and can't be used as a store subdomain.`,
    };
  }
  return { ok: true };
}

/**
 * Labels that are reserved but intentionally not valid store slugs (too short
 * for the slug format). They are reserved only so a store can never claim them.
 */
const INTENTIONAL_NON_SLUG_LABELS: ReadonlySet<string> = new Set<string>(["mx"]);

/**
 * Registry invariants (report §3.6, "CI test asserts"). Returns human-readable
 * violations; an empty array means the registry is consistent. Used by the
 * test suite and safe to call from CI.
 */
export function listReservationViolations(): string[] {
  const violations: string[] = [];

  const seen = new Map<string, number>();
  for (const entry of RESERVED_LABEL_ENTRIES) {
    seen.set(entry.label, (seen.get(entry.label) ?? 0) + 1);
  }
  for (const [label, count] of seen) {
    if (count > 1) violations.push(`duplicate reserved label "${label}" (${count} entries)`);
  }

  for (const entry of RESERVED_LABEL_ENTRIES) {
    if (INTENTIONAL_NON_SLUG_LABELS.has(entry.label)) continue;
    if (!checkStoreSlug(entry.label, { allowReserved: true }).ok) {
      violations.push(`reserved label "${entry.label}" fails the store slug format`);
    }
  }

  for (const themeSlug of THEME_SLUGS) {
    const disposition = getReservedDisposition(themeSlug);
    if (disposition?.kind !== "theme-name" || disposition.themeSlug !== themeSlug) {
      violations.push(`theme slug "${themeSlug}" is not reserved as a theme name`);
    }
  }

  const prefixSeen = new Set<string>();
  for (const prefix of RESERVED_PATH_PREFIXES) {
    if (prefixSeen.has(prefix)) violations.push(`duplicate reserved path prefix "${prefix}"`);
    prefixSeen.add(prefix);
  }

  return violations;
}
