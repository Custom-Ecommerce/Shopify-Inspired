#!/usr/bin/env node
// apps/storefront/REDESIGNSCRIPTS/patch_redesign_P0.mjs
//
// Markazify redesign, phase P0: foundation and guardrails (storefront only).
// Zero dependencies. Flags: --dry-run | --apply | --verify | --revert
//
// Scope for this run: apps/storefront only. Seller, admin, design-system, themes and the
// monorepo root are not touched.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PHASE = "P0";
const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = path.resolve(here, "../../..");
const SF = path.join(ROOT, "apps", "storefront");
const BACKUP = path.join(here, ".backup", PHASE);
const MANIFEST_FILE = path.join(BACKUP, "manifest.json");

const M = {
  "modify": [
    {
      "rel": "apps/storefront/app/globals.css",
      "beforeSha": "d12984e42ba8a7282ebde18b3e87acae605fa95a570d1f10b1ac0a5dcd3536f4",
      "afterSha": "56f752d6b63747cdceadffd4d37e34349d5b7bdcd7adc08f38651b36577ce672",
      "edits": [
        {
          "name": "import tokens",
          "expect": 1,
          "before": [
            "@import \"tw-animate-css\";",
            ""
          ],
          "after": [
            "@import \"tw-animate-css\";",
            "@import \"../styles/tokens.css\";",
            ""
          ]
        },
        {
          "name": "token header note",
          "expect": 1,
          "before": [
            " *    Flat, minimalist, HCI-compliant surface hierarchy & crisp elevation.",
            ""
          ],
          "after": [
            " *    Colour, radius and shadow tokens live in styles/tokens.css. Layout, type and motion tokens stay here.",
            ""
          ]
        },
        {
          "name": "root colour, radius, shadow tokens",
          "expect": 1,
          "before": [
            "  /* ---- Core surfaces (Pure white & crisp neutral grays) ---- */",
            "  --background: oklch(1 0 0);",
            "  --background-elevated: oklch(0.99 0 0);",
            "  --foreground: oklch(0.145 0.015 255);",
            "",
            "  --card: oklch(1 0 0);",
            "  --card-foreground: oklch(0.145 0.015 255);",
            "",
            "  --popover: oklch(1 0 0);",
            "  --popover-foreground: oklch(0.145 0.015 255);",
            "",
            "  /* ---- Brand (Electric Cobalt) ---- */",
            "  --primary: oklch(0.55 0.21 258);",
            "  --primary-hover: oklch(0.50 0.22 258);",
            "  --primary-foreground: oklch(0.99 0 0);",
            "  --primary-soft: oklch(0.97 0.015 258);",
            "",
            "  /* ---- Secondary / Neutral surface ---- */",
            "  --secondary: oklch(0.965 0.005 255);",
            "  --secondary-foreground: oklch(0.205 0.015 255);",
            "",
            "  /* ---- Muted ---- */",
            "  --muted: oklch(0.965 0.005 255);",
            "  --muted-foreground: oklch(0.46 0.015 255);",
            "",
            "  /* ---- Accent ---- */",
            "  --accent: oklch(0.965 0.005 255);",
            "  --accent-foreground: oklch(0.205 0.015 255);",
            "",
            "  /* ---- Semantic states ---- */",
            "  --destructive: oklch(0.58 0.22 27);",
            "  --destructive-foreground: oklch(0.99 0 0);",
            "",
            "  --success: oklch(0.52 0.14 152);",
            "  --success-foreground: oklch(0.99 0 0);",
            "",
            "  --warning: oklch(0.75 0.16 75);",
            "  --warning-foreground: oklch(0.20 0.02 75);",
            "",
            "  /* ---- Chrome ---- */",
            "  --border: oklch(0.91 0.005 255);",
            "  --border-strong: oklch(0.84 0.008 255);",
            "  --input: oklch(0.91 0.005 255);",
            "  --ring: oklch(0.55 0.21 258);",
            "",
            "  /* ---- Radius scale ---- */",
            "  --radius: 0.75rem;",
            "",
            "  /* ---- Flat, crisp HCI shadows ---- */",
            "  --shadow-2xs: 0 1px 1px 0 rgb(0 0 0 / 0.03);",
            "  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.04);",
            "  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);",
            "  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);",
            "  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);",
            "  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);",
            "",
            ""
          ],
          "after": [
            ""
          ]
        },
        {
          "name": "dark block",
          "expect": 1,
          "before": [
            ".dark {",
            "  --background: oklch(0.14 0.012 255);",
            "  --background-elevated: oklch(0.17 0.014 255);",
            "  --foreground: oklch(0.97 0.005 255);",
            "",
            "  --card: oklch(0.17 0.014 255);",
            "  --card-foreground: oklch(0.97 0.005 255);",
            "",
            "  --popover: oklch(0.17 0.014 255);",
            "  --popover-foreground: oklch(0.97 0.005 255);",
            "",
            "  --primary: oklch(0.65 0.20 255);",
            "  --primary-hover: oklch(0.70 0.20 255);",
            "  --primary-foreground: oklch(0.12 0.015 255);",
            "  --primary-soft: oklch(0.24 0.05 255);",
            "",
            "  --secondary: oklch(0.22 0.015 255);",
            "  --secondary-foreground: oklch(0.95 0.005 255);",
            "",
            "  --muted: oklch(0.22 0.015 255);",
            "  --muted-foreground: oklch(0.68 0.015 255);",
            "",
            "  --accent: oklch(0.22 0.015 255);",
            "  --accent-foreground: oklch(0.97 0.005 255);",
            "",
            "  --destructive: oklch(0.64 0.21 25);",
            "  --destructive-foreground: oklch(0.14 0.015 255);",
            "",
            "  --success: oklch(0.68 0.17 152);",
            "  --success-foreground: oklch(0.14 0.02 152);",
            "",
            "  --warning: oklch(0.78 0.16 75);",
            "  --warning-foreground: oklch(0.16 0.02 75);",
            "",
            "  --border: oklch(0.26 0.015 255);",
            "  --border-strong: oklch(0.34 0.018 255);",
            "  --input: oklch(0.26 0.015 255);",
            "  --ring: oklch(0.65 0.20 255);",
            "",
            "  --shadow-2xs: 0 1px 1px 0 rgb(0 0 0 / 0.2);",
            "  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.25);",
            "  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);",
            "  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.35), 0 2px 4px -2px rgb(0 0 0 / 0.25);",
            "  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3);",
            "  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.35);",
            "}",
            ""
          ],
          "after": [
            ""
          ]
        },
        {
          "name": "theme colour, radius, shadow mapping",
          "expect": 1,
          "before": [
            "  --color-background: var(--background);",
            "  --color-background-elevated: var(--background-elevated);",
            "  --color-foreground: var(--foreground);",
            "",
            "  --color-card: var(--card);",
            "  --color-card-foreground: var(--card-foreground);",
            "",
            "  --color-popover: var(--popover);",
            "  --color-popover-foreground: var(--popover-foreground);",
            "",
            "  --color-primary: var(--primary);",
            "  --color-primary-hover: var(--primary-hover);",
            "  --color-primary-foreground: var(--primary-foreground);",
            "  --color-primary-soft: var(--primary-soft);",
            "",
            "  --color-secondary: var(--secondary);",
            "  --color-secondary-foreground: var(--secondary-foreground);",
            "",
            "  --color-muted: var(--muted);",
            "  --color-muted-foreground: var(--muted-foreground);",
            "",
            "  --color-accent: var(--accent);",
            "  --color-accent-foreground: var(--accent-foreground);",
            "",
            "  --color-destructive: var(--destructive);",
            "  --color-destructive-foreground: var(--destructive-foreground);",
            "",
            "  --color-success: var(--success);",
            "  --color-success-foreground: var(--success-foreground);",
            "",
            "  --color-warning: var(--warning);",
            "  --color-warning-foreground: var(--warning-foreground);",
            "",
            "  --color-border: var(--border);",
            "  --color-border-strong: var(--border-strong);",
            "  --color-input: var(--input);",
            "  --color-ring: var(--ring);",
            "",
            "  --radius-sm: calc(var(--radius) - 4px);",
            "  --radius-md: calc(var(--radius) - 2px);",
            "  --radius-lg: var(--radius);",
            "  --radius-xl: calc(var(--radius) + 4px);",
            "  --radius-2xl: calc(var(--radius) + 8px);",
            "  --radius-3xl: calc(var(--radius) + 16px);",
            "",
            "  --shadow-2xs: var(--shadow-2xs);",
            "  --shadow-xs: var(--shadow-xs);",
            "  --shadow-sm: var(--shadow-sm);",
            "  --shadow-md: var(--shadow-md);",
            "  --shadow-lg: var(--shadow-lg);",
            "  --shadow-xl: var(--shadow-xl);",
            "",
            ""
          ],
          "after": [
            ""
          ]
        },
        {
          "name": "mono font mapping",
          "expect": 1,
          "before": [
            "  --font-heading: var(--font-sans), ui-sans-serif, system-ui, -apple-system,",
            "    BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;",
            ""
          ],
          "after": [
            "  --font-heading: var(--font-sans), ui-sans-serif, system-ui, -apple-system,",
            "    BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;",
            "  --font-mono: var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
            ""
          ]
        },
        {
          "name": "font feature settings",
          "expect": 1,
          "before": [
            "font-feature-settings: \"cv02\", \"cv03\", \"cv04\", \"cv11\";"
          ],
          "after": [
            "font-feature-settings: \"cv01\", \"ss03\";"
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/app/layout.tsx",
      "beforeSha": "e32d784c1aa20688848479853b2030c303e5705ca096bdb299ccbefaca8aacd8",
      "afterSha": "12cbc80599b13eff644d549f59f4e7fa02c84407556a6fd503832b4775362242",
      "edits": [
        {
          "name": "font import",
          "expect": 1,
          "before": [
            "import { Plus_Jakarta_Sans } from \"next/font/google\";"
          ],
          "after": [
            "import { Inter, JetBrains_Mono } from \"next/font/google\";"
          ]
        },
        {
          "name": "font definitions",
          "expect": 1,
          "before": [
            "const fontSans = Plus_Jakarta_Sans({",
            "  subsets: [\"latin\"],",
            "  weight: [\"400\", \"500\", \"600\", \"700\"],",
            "  variable: \"--font-sans\",",
            "  display: \"swap\",",
            "});",
            ""
          ],
          "after": [
            "const fontSans = Inter({",
            "  subsets: [\"latin\"],",
            "  variable: \"--font-sans\",",
            "  display: \"swap\",",
            "});",
            "",
            "const fontMono = JetBrains_Mono({",
            "  subsets: [\"latin\"],",
            "  variable: \"--font-mono\",",
            "  display: \"swap\",",
            "});",
            ""
          ]
        },
        {
          "name": "html font classes",
          "expect": 1,
          "before": [
            "      className={fontSans.variable}",
            ""
          ],
          "after": [
            "      className={`${fontSans.variable} ${fontMono.variable}`}",
            ""
          ]
        }
      ]
    },
    {
      "rel": "apps/storefront/package.json",
      "beforeSha": "e25c9d8fe0770feefe7a2bdd751ae59f438146f2d07caca907f910c457bf532f",
      "afterSha": "475b3bada3baf0dfd705e7609e7f04560f0a7ec23545af77e1ebf7e6d272b117",
      "edits": [
        {
          "name": "check scripts",
          "expect": 1,
          "before": [
            "    \"check:contrast\": \"node scripts/check-contrast.mjs\"",
            "  },"
          ],
          "after": [
            "    \"check:contrast\": \"node scripts/check-contrast.mjs\",",
            "    \"check:tokens\": \"node scripts/check-tokens.mjs\",",
            "    \"check:scope\": \"node scripts/check-scope.mjs\",",
            "    \"baseline:capture\": \"node scripts/baseline-capture.mjs\"",
            "  },"
          ]
        }
      ]
    }
  ],
  "create": [
    {
      "rel": "apps/storefront/styles/tokens.css",
      "lines": [
        "/* @markaz/storefront:p0-tokens",
        " *",
        " * The single source of colour, radius and shadow tokens for the storefront.",
        " * No other file may contain a hex, oklch, rgb or hsl literal, or a Tailwind palette class.",
        " *",
        " * Base: shadcn Zinc. Theme: neutral. Primary is the inverse pair (near-white on dark,",
        " * near-black on light). Colour appears only in the status tokens.",
        " *",
        " * Provenance: the Zinc values are the shadcn published Zinc theme. They were not generated",
        " * by the CLI in this session (registry unreachable). To confirm, run",
        " *   pnpm dlx shadcn@latest init --base-color zinc",
        " * in a scratch project and diff its :root and .dark blocks against this file.",
        " * Deliberate departures from stock Zinc: light --ring is darker (3:1 UI contrast),",
        " * chart-1..5 are neutral steps, status tokens, surface levels and legacy aliases are added.",
        " */",
        "",
        ":root {",
        "  /* ---- Surfaces ---- */",
        "  --background: oklch(1 0 0);",
        "  --foreground: oklch(0.141 0.005 285.823);",
        "  --card: oklch(1 0 0);",
        "  --card-foreground: oklch(0.141 0.005 285.823);",
        "  --popover: oklch(1 0 0);",
        "  --popover-foreground: oklch(0.141 0.005 285.823);",
        "  --surface-1: oklch(0.985 0 0);",
        "  --surface-2: oklch(0.967 0.001 286.375);",
        "",
        "  /* ---- Actions (neutral) ---- */",
        "  --primary: oklch(0.21 0.006 285.885);",
        "  --primary-foreground: oklch(0.985 0 0);",
        "  --secondary: oklch(0.967 0.001 286.375);",
        "  --secondary-foreground: oklch(0.21 0.006 285.885);",
        "  --muted: oklch(0.967 0.001 286.375);",
        "  --muted-foreground: oklch(0.5 0.016 285.938);",
        "  --text-tertiary: oklch(0.535 0.016 285.938);",
        "  --accent: oklch(0.967 0.001 286.375);",
        "  --accent-foreground: oklch(0.21 0.006 285.885);",
        "",
        "  /* ---- Structure ---- */",
        "  --border: oklch(0.92 0.004 286.32);",
        "  --border-strong: oklch(0.871 0.006 286.286);",
        "  --input: oklch(0.92 0.004 286.32);",
        "  --ring: oklch(0.552 0.016 285.938);",
        "",
        "  /* ---- Status: the only chroma in the UI ---- */",
        "  --destructive: oklch(0.577 0.245 27.325);",
        "  --destructive-foreground: oklch(0.985 0 0);",
        "  --destructive-subtle: oklch(0.96 0.03 27);",
        "  --destructive-subtle-foreground: oklch(0.45 0.18 27);",
        "  --success: oklch(0.52 0.14 152);",
        "  --success-foreground: oklch(0.985 0 0);",
        "  --success-subtle: oklch(0.962 0.04 152);",
        "  --success-subtle-foreground: oklch(0.4 0.1 152);",
        "  --warning: oklch(0.75 0.16 75);",
        "  --warning-foreground: oklch(0.2 0.02 75);",
        "  --warning-subtle: oklch(0.965 0.05 85);",
        "  --warning-subtle-foreground: oklch(0.42 0.09 65);",
        "  --info: oklch(0.55 0.15 250);",
        "  --info-foreground: oklch(0.985 0 0);",
        "  --info-subtle: oklch(0.96 0.03 250);",
        "  --info-subtle-foreground: oklch(0.42 0.12 255);",
        "",
        "  /* ---- Charts (neutral steps; status colours are never chart series) ---- */",
        "  --chart-1: oklch(0.21 0.006 285.885);",
        "  --chart-2: oklch(0.442 0.017 285.786);",
        "  --chart-3: oklch(0.552 0.016 285.938);",
        "  --chart-4: oklch(0.705 0.015 286.067);",
        "  --chart-5: oklch(0.871 0.006 286.286);",
        "",
        "  /* ---- Legacy aliases. Kept for existing callers; removed in P6. ---- */",
        "  --background-elevated: var(--surface-1);",
        "  --primary-hover: color-mix(in oklab, var(--primary) 88%, var(--background));",
        "  --primary-soft: var(--secondary);",
        "",
        "  /* ---- Radius ---- */",
        "  --radius: 0.75rem;",
        "",
        "  /* ---- Shadows (unchanged in P0; resting shadows are removed in P6) ---- */",
        "  --shadow-2xs: 0 1px 1px 0 rgb(0 0 0 / 0.03);",
        "  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.04);",
        "  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);",
        "  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);",
        "  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);",
        "  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);",
        "}",
        "",
        ".dark {",
        "  color-scheme: dark;",
        "",
        "  --background: oklch(0.141 0.005 285.823);",
        "  --foreground: oklch(0.985 0 0);",
        "  --card: oklch(0.21 0.006 285.885);",
        "  --card-foreground: oklch(0.985 0 0);",
        "  --popover: oklch(0.21 0.006 285.885);",
        "  --popover-foreground: oklch(0.985 0 0);",
        "  --surface-1: oklch(0.21 0.006 285.885);",
        "  --surface-2: oklch(0.244 0.006 286.033);",
        "",
        "  --primary: oklch(0.92 0.004 286.32);",
        "  --primary-foreground: oklch(0.21 0.006 285.885);",
        "  --secondary: oklch(0.274 0.006 286.033);",
        "  --secondary-foreground: oklch(0.985 0 0);",
        "  --muted: oklch(0.274 0.006 286.033);",
        "  --muted-foreground: oklch(0.705 0.015 286.067);",
        "  --text-tertiary: oklch(0.64 0.015 286.067);",
        "  --accent: oklch(0.274 0.006 286.033);",
        "  --accent-foreground: oklch(0.985 0 0);",
        "",
        "  --border: oklch(1 0 0 / 10%);",
        "  --border-strong: oklch(1 0 0 / 18%);",
        "  --input: oklch(1 0 0 / 15%);",
        "  --ring: oklch(0.705 0.015 286.067);",
        "",
        "  --destructive: oklch(0.704 0.191 22.216);",
        "  --destructive-foreground: oklch(0.141 0.005 285.823);",
        "  --destructive-subtle: oklch(0.27 0.07 25);",
        "  --destructive-subtle-foreground: oklch(0.82 0.12 22);",
        "  --success: oklch(0.68 0.17 152);",
        "  --success-foreground: oklch(0.141 0.005 285.823);",
        "  --success-subtle: oklch(0.27 0.06 152);",
        "  --success-subtle-foreground: oklch(0.82 0.13 152);",
        "  --warning: oklch(0.78 0.16 75);",
        "  --warning-foreground: oklch(0.16 0.02 75);",
        "  --warning-subtle: oklch(0.28 0.06 75);",
        "  --warning-subtle-foreground: oklch(0.85 0.12 80);",
        "  --info: oklch(0.7 0.14 250);",
        "  --info-foreground: oklch(0.141 0.005 285.823);",
        "  --info-subtle: oklch(0.27 0.05 250);",
        "  --info-subtle-foreground: oklch(0.82 0.1 250);",
        "",
        "  --chart-1: oklch(0.92 0.004 286.32);",
        "  --chart-2: oklch(0.705 0.015 286.067);",
        "  --chart-3: oklch(0.552 0.016 285.938);",
        "  --chart-4: oklch(0.442 0.017 285.786);",
        "  --chart-5: oklch(0.37 0.013 285.805);",
        "",
        "  --shadow-2xs: 0 1px 1px 0 rgb(0 0 0 / 0.2);",
        "  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.25);",
        "  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);",
        "  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.35), 0 2px 4px -2px rgb(0 0 0 / 0.25);",
        "  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3);",
        "  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.35);",
        "}",
        "",
        "@theme inline {",
        "  --color-background: var(--background);",
        "  --color-foreground: var(--foreground);",
        "  --color-card: var(--card);",
        "  --color-card-foreground: var(--card-foreground);",
        "  --color-popover: var(--popover);",
        "  --color-popover-foreground: var(--popover-foreground);",
        "  --color-surface-1: var(--surface-1);",
        "  --color-surface-2: var(--surface-2);",
        "  --color-background-elevated: var(--background-elevated);",
        "",
        "  --color-primary: var(--primary);",
        "  --color-primary-hover: var(--primary-hover);",
        "  --color-primary-foreground: var(--primary-foreground);",
        "  --color-primary-soft: var(--primary-soft);",
        "  --color-secondary: var(--secondary);",
        "  --color-secondary-foreground: var(--secondary-foreground);",
        "  --color-muted: var(--muted);",
        "  --color-muted-foreground: var(--muted-foreground);",
        "  --color-text-tertiary: var(--text-tertiary);",
        "  --color-accent: var(--accent);",
        "  --color-accent-foreground: var(--accent-foreground);",
        "",
        "  --color-border: var(--border);",
        "  --color-border-strong: var(--border-strong);",
        "  --color-input: var(--input);",
        "  --color-ring: var(--ring);",
        "",
        "  --color-destructive: var(--destructive);",
        "  --color-destructive-foreground: var(--destructive-foreground);",
        "  --color-destructive-subtle: var(--destructive-subtle);",
        "  --color-destructive-subtle-foreground: var(--destructive-subtle-foreground);",
        "  --color-success: var(--success);",
        "  --color-success-foreground: var(--success-foreground);",
        "  --color-success-subtle: var(--success-subtle);",
        "  --color-success-subtle-foreground: var(--success-subtle-foreground);",
        "  --color-warning: var(--warning);",
        "  --color-warning-foreground: var(--warning-foreground);",
        "  --color-warning-subtle: var(--warning-subtle);",
        "  --color-warning-subtle-foreground: var(--warning-subtle-foreground);",
        "  --color-info: var(--info);",
        "  --color-info-foreground: var(--info-foreground);",
        "  --color-info-subtle: var(--info-subtle);",
        "  --color-info-subtle-foreground: var(--info-subtle-foreground);",
        "",
        "  --color-chart-1: var(--chart-1);",
        "  --color-chart-2: var(--chart-2);",
        "  --color-chart-3: var(--chart-3);",
        "  --color-chart-4: var(--chart-4);",
        "  --color-chart-5: var(--chart-5);",
        "",
        "  --radius-sm: 6px;",
        "  --radius-md: 8px;",
        "  --radius-lg: var(--radius);",
        "  --radius-xl: calc(var(--radius) + 4px);",
        "  --radius-2xl: calc(var(--radius) + 8px);",
        "  --radius-3xl: calc(var(--radius) + 16px);",
        "",
        "  --shadow-2xs: var(--shadow-2xs);",
        "  --shadow-xs: var(--shadow-xs);",
        "  --shadow-sm: var(--shadow-sm);",
        "  --shadow-md: var(--shadow-md);",
        "  --shadow-lg: var(--shadow-lg);",
        "  --shadow-xl: var(--shadow-xl);",
        "}",
        ""
      ]
    },
    {
      "rel": "apps/storefront/styles/tokens.ts",
      "lines": [
        "/* @markaz/storefront:p0-tokens",
        " * Token names for JS consumers. Values live in tokens.css and nowhere else.",
        " */",
        "export const colorTokens = [",
        "  \"background\", \"foreground\", \"card\", \"card-foreground\", \"popover\", \"popover-foreground\",",
        "  \"surface-1\", \"surface-2\", \"primary\", \"primary-foreground\", \"secondary\", \"secondary-foreground\",",
        "  \"muted\", \"muted-foreground\", \"text-tertiary\", \"accent\", \"accent-foreground\",",
        "  \"border\", \"border-strong\", \"input\", \"ring\",",
        "] as const;",
        "",
        "export const statusTokens = [\"destructive\", \"success\", \"warning\", \"info\"] as const;",
        "export const chartTokens = [\"chart-1\", \"chart-2\", \"chart-3\", \"chart-4\", \"chart-5\"] as const;",
        "export const radiusTokens = { sm: \"6px\", md: \"8px\", lg: \"0.75rem\" } as const;",
        "",
        "export type ColorToken = (typeof colorTokens)[number];",
        "export type StatusToken = (typeof statusTokens)[number];",
        "",
        "/** CSS variable reference for a token, for inline styles and chart props. */",
        "export const cssVar = (name: string) => `var(--${name})`;",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/check-flat.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// Counts shadow utilities in marketing and shared code. Report-only until P6 removes resting shadows.",
        "// Run with --strict to fail when the count is above the target (10).",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const targets = [\"app/(marketing)\", \"components/marketing\", \"components/shared\"];",
        "const TARGET = 10;",
        "const re = /(?<![\\w-])(?:[\\w-]+:)*shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner)(?![\\w-])/g;",
        "",
        "function walk(p, out = []) {",
        "  if (!fs.existsSync(p)) return out;",
        "  const st = fs.statSync(p);",
        "  if (st.isFile()) { if (/\\.(tsx?|css)$/.test(p)) out.push(p); return out; }",
        "  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);",
        "  return out;",
        "}",
        "",
        "let total = 0;",
        "const per = [];",
        "for (const t of targets) {",
        "  for (const file of walk(path.join(root, t))) {",
        "    const n = (fs.readFileSync(file, \"utf8\").match(re) || []).length;",
        "    if (n) { total += n; per.push([path.relative(root, file).split(path.sep).join(\"/\"), n]); }",
        "  }",
        "}",
        "if (process.argv.includes(\"--list\")) per.forEach(([f, n]) => console.log(`${String(n).padStart(3)}  ${f}`));",
        "const strict = process.argv.includes(\"--strict\");",
        "const ok = total <= TARGET;",
        "console.log(`check:flat  ${ok ? \"PASS\" : strict ? \"FAIL\" : \"INFO\"}  (${total} shadow utilities, target ${TARGET}${strict ? \"\" : \", report-only until P6\"})`);",
        "process.exit(strict && !ok ? 1 : 0);",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/check-classes.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// No Tailwind palette classes and no arbitrary colour classes in the redesign scope.",
        "// Scope matches check-tokens. app/(system) and app/(store) are out of scope. Zero dependencies.",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const targets = [\"app/(marketing)\", \"app/layout.tsx\", \"components/marketing\", \"components/shared\", \"components/ui\"];",
        "const exts = new Set([\".ts\", \".tsx\"]);",
        "",
        "function walk(p, out = []) {",
        "  if (!fs.existsSync(p)) return out;",
        "  const st = fs.statSync(p);",
        "  if (st.isFile()) { if (exts.has(path.extname(p))) out.push(p); return out; }",
        "  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);",
        "  return out;",
        "}",
        "",
        "const palette = \"slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose\";",
        "const util = \"bg|text|border|ring|ring-offset|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder\";",
        "const rules = [",
        "  [\"palette class\", new RegExp(`(?<![\\\\w-])(?:${util})-(?:${palette})-\\\\d{2,3}(?![\\\\w-])`)],",
        "  [\"raw white or black class\", /(?<![\\w-])(?:bg|text|border|ring|from|via|to|fill|stroke)-(?:white|black)(?![\\w-])/],",
        "  [\"arbitrary colour class\", /(?<![\\w-])(?:bg|text|border|ring|from|via|to|fill|stroke|shadow)-\\[(?:#|rgb|hsl|oklch|color:)/],",
        "];",
        "",
        "let fail = 0;",
        "for (const t of targets) {",
        "  for (const file of walk(path.join(root, t))) {",
        "    const rel = path.relative(root, file).split(path.sep).join(\"/\");",
        "    fs.readFileSync(file, \"utf8\").split(/\\r?\\n/).forEach((line, i) => {",
        "      for (const [name, re] of rules) {",
        "        if (re.test(line)) { fail++; console.log(`FAIL  ${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 100)}`); }",
        "      }",
        "    });",
        "  }",
        "}",
        "console.log(`check:classes  ${fail === 0 ? \"PASS\" : \"FAIL\"}  (${fail} violations)`);",
        "process.exit(fail === 0 ? 0 : 1);",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/check-contrast.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// WCAG AA contrast for token pairs in both themes. Reads styles/tokens.css. Zero dependencies.",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const css = fs.readFileSync(path.join(root, \"styles\", \"tokens.css\"), \"utf8\").replace(/\\/\\*[\\s\\S]*?\\*\\//g, \"\");",
        "",
        "function block(selector) {",
        "  const m = css.match(new RegExp(\"(?:^|\\\\n)\" + selector + \"\\\\s*\\\\{([\\\\s\\\\S]*?)\\\\n\\\\}\", \"m\"));",
        "  if (!m) throw new Error(\"tokens.css: block not found: \" + selector);",
        "  const map = {};",
        "  for (const d of m[1].matchAll(/--([\\w-]+)\\s*:\\s*([^;]+);/g)) map[d[1]] = d[2].trim();",
        "  return map;",
        "}",
        "const light = block(\":root\");",
        "const dark = { ...light, ...block(\"\\\\.dark\") };",
        "",
        "const clamp = (x) => Math.min(1, Math.max(0, x));",
        "const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);",
        "const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));",
        "",
        "function oklchToSrgb(L, C, H) {",
        "  const a = C * Math.cos((H * Math.PI) / 180);",
        "  const b = C * Math.sin((H * Math.PI) / 180);",
        "  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);",
        "  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);",
        "  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);",
        "  const lin = [",
        "    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,",
        "    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,",
        "    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,",
        "  ];",
        "  return lin.map((c) => toGamma(clamp(c))); // gamma-encoded sRGB 0..1",
        "}",
        "",
        "function resolve(map, name, depth = 0) {",
        "  let v = map[name];",
        "  if (v === undefined || depth > 8) return null;",
        "  const alias = v.match(/^var\\(--([\\w-]+)\\)$/);",
        "  if (alias) return resolve(map, alias[1], depth + 1);",
        "  const m = v.match(/^oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+)(%)?)?\\s*\\)$/);",
        "  if (!m) return null; // color-mix and other functions are not checked",
        "  const alpha = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4]);",
        "  return { rgb: oklchToSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])), alpha };",
        "}",
        "",
        "function over(fg, bg) {",
        "  return fg.rgb.map((c, i) => c * fg.alpha + bg.rgb[i] * (1 - fg.alpha));",
        "}",
        "function luminance(rgbGamma) {",
        "  const [r, g, b] = rgbGamma.map(toLinear);",
        "  return 0.2126 * r + 0.7152 * g + 0.0722 * b;",
        "}",
        "function ratio(fgName, bgName, map) {",
        "  const fg = resolve(map, fgName);",
        "  const bg = resolve(map, bgName);",
        "  if (!fg || !bg) return null;",
        "  const base = bg.alpha < 1 ? { rgb: over(bg, resolve(map, \"background\")), alpha: 1 } : bg;",
        "  const l1 = luminance(fg.alpha < 1 ? over(fg, base) : fg.rgb);",
        "  const l2 = luminance(base.rgb);",
        "  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);",
        "}",
        "",
        "const surfaces = [\"background\", \"card\", \"surface-1\", \"surface-2\"];",
        "const text = [",
        "  [\"foreground\", \"background\"], [\"foreground\", \"surface-1\"], [\"foreground\", \"surface-2\"],",
        "  [\"card-foreground\", \"card\"], [\"popover-foreground\", \"popover\"],",
        "  [\"primary\", \"background\"], [\"primary-foreground\", \"primary\"],",
        "  [\"secondary-foreground\", \"secondary\"], [\"accent-foreground\", \"accent\"],",
        "  [\"primary\", \"primary-soft\"],",
        "  ...surfaces.map((s) => [\"muted-foreground\", s]),",
        "  ...surfaces.map((s) => [\"text-tertiary\", s]),",
        "  [\"muted-foreground\", \"secondary\"],",
        "  ...[\"destructive\", \"success\", \"warning\", \"info\"].flatMap((k) => [",
        "    [`${k}-foreground`, k],",
        "    [`${k}-subtle-foreground`, `${k}-subtle`],",
        "    [`${k}-subtle-foreground`, \"background\"],",
        "  ]),",
        "];",
        "const ui = [[\"ring\", \"background\"], [\"ring\", \"card\"], [\"ring\", \"surface-1\"]];",
        "",
        "let fail = 0;",
        "let skipped = 0;",
        "for (const [themeName, map] of [[\"light\", light], [\"dark\", dark]]) {",
        "  for (const [list, min, kind] of [[text, 4.5, \"text\"], [ui, 3, \"ui\"]]) {",
        "    for (const [fg, bg] of list) {",
        "      const r = ratio(fg, bg, map);",
        "      if (r === null) { skipped++; continue; }",
        "      const ok = r >= min;",
        "      if (!ok) fail++;",
        "      if (!ok || process.argv.includes(\"--all\")) {",
        "        console.log(`${ok ? \"pass\" : \"FAIL\"}  ${themeName.padEnd(5)} ${kind.padEnd(4)} ${fg} on ${bg}  ${r.toFixed(2)} (min ${min})`);",
        "      }",
        "    }",
        "  }",
        "}",
        "console.log(`check:contrast  ${fail === 0 ? \"PASS\" : \"FAIL\"}  (${fail} failing, ${skipped} pairs skipped: unresolved)`);",
        "process.exit(fail === 0 ? 0 : 1);",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/check-tokens.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// No colour literal outside styles/tokens.css. Scope: marketing routes, marketing and shared",
        "// components, ui primitives, content, root layout and globals.css. Zero dependencies.",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const targets = [",
        "  \"app/(marketing)\", \"app/layout.tsx\", \"app/globals.css\",",
        "  \"components/marketing\", \"components/shared\", \"components/ui\", \"content/marketing\",",
        "];",
        "const exts = new Set([\".ts\", \".tsx\", \".css\", \".mjs\"]);",
        "",
        "function walk(p, out = []) {",
        "  if (!fs.existsSync(p)) return out;",
        "  const st = fs.statSync(p);",
        "  if (st.isFile()) { if (exts.has(path.extname(p))) out.push(p); return out; }",
        "  for (const e of fs.readdirSync(p)) walk(path.join(p, e), out);",
        "  return out;",
        "}",
        "",
        "const rules = [",
        "  [\"hex literal\", /(?<![\\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\\w-])/],",
        "  [\"oklch literal\", /\\boklch\\(/],",
        "  [\"rgb literal\", /\\brgba?\\(/],",
        "  [\"hsl literal\", /\\bhsla?\\(/],",
        "];",
        "",
        "let fail = 0;",
        "for (const t of targets) {",
        "  for (const file of walk(path.join(root, t))) {",
        "    const rel = path.relative(root, file).split(path.sep).join(\"/\");",
        "    const lines = fs.readFileSync(file, \"utf8\").split(/\\r?\\n/);",
        "    lines.forEach((line, i) => {",
        "      // The viewport themeColor in the root layout is browser chrome metadata, not UI colour.",
        "      if (rel === \"app/layout.tsx\" && /color:\\s*\"#[0-9a-fA-F]{3,8}\"/.test(line)) return;",
        "      for (const [name, re] of rules) {",
        "        if (re.test(line)) { fail++; console.log(`FAIL  ${rel}:${i + 1}  ${name}: ${line.trim().slice(0, 100)}`); }",
        "      }",
        "    });",
        "  }",
        "}",
        "console.log(`check:tokens  ${fail === 0 ? \"PASS\" : \"FAIL\"}  (${fail} violations)`);",
        "process.exit(fail === 0 ? 0 : 1);",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/check-scope.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// Fails if a changed path (git status) is outside the allowlist of the given phase.",
        "// Usage: node scripts/check-scope.mjs P0",
        "import { execFileSync } from \"node:child_process\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const here = fileURLToPath(new URL(\".\", import.meta.url));",
        "const phase = process.argv[2];",
        "",
        "// Paths are relative to the monorepo root. \"**\" matches anything below a folder.",
        "const ALLOW = {",
        "  P0: [",
        "    \"apps/storefront/scripts/**\",",
        "    \"apps/storefront/styles/**\",",
        "    \"apps/storefront/app/globals.css\",",
        "    \"apps/storefront/app/layout.tsx\",",
        "    \"apps/storefront/package.json\",",
        "  ],",
        "};",
        "const ALWAYS = [\"apps/storefront/REDESIGNSCRIPTS/**\"];",
        "",
        "if (!phase || !ALLOW[phase]) {",
        "  console.log(`check:scope  FAIL  (unknown phase \"${phase ?? \"\"}\". Known: ${Object.keys(ALLOW).join(\", \")})`);",
        "  process.exit(1);",
        "}",
        "",
        "const git = (...a) => execFileSync(\"git\", a, { cwd: here, encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"] });",
        "let top;",
        "let out;",
        "try {",
        "  top = git(\"rev-parse\", \"--show-toplevel\").trim();",
        "  out = git(\"status\", \"--porcelain\", \"-uall\", \"--\", top);",
        "} catch (e) {",
        "  console.log(\"check:scope  FAIL  (git is not available or this is not a git checkout)\");",
        "  process.exit(1);",
        "}",
        "",
        "const match = (p, pat) => (pat.endsWith(\"/**\") ? p.startsWith(pat.slice(0, -2)) : p === pat);",
        "const changed = out.split(\"\\n\").filter(Boolean).map((l) => l.slice(3).replace(/^\"|\"$/g, \"\").split(\" -> \").pop());",
        "const bad = changed.filter((p) => ![...ALLOW[phase], ...ALWAYS].some((pat) => match(p, pat)));",
        "bad.forEach((p) => console.log(`FAIL  outside ${phase} allowlist: ${p}`));",
        "console.log(`check:scope  ${bad.length === 0 ? \"PASS\" : \"FAIL\"}  (${changed.length} changed, ${bad.length} outside the ${phase} allowlist)`);",
        "process.exit(bad.length === 0 ? 0 : 1);",
        ""
      ]
    },
    {
      "rel": "apps/storefront/scripts/baseline-capture.mjs",
      "lines": [
        "// @markaz/storefront:p0-guards",
        "// Screenshots every marketing route (plus two demo-store routes as a leak check) at 375, 768, 1440.",
        "// Not run by the P0 patch. Playwright is a dev-only tool and is imported lazily:",
        "//   pnpm --filter @markaz/storefront add -D playwright && pnpm exec playwright install chromium",
        "// Usage: node scripts/baseline-capture.mjs --label before|after [--base-url http://localhost:3000] [--theme dark|light]",
        "import fs from \"node:fs\";",
        "import path from \"node:path\";",
        "import { fileURLToPath } from \"node:url\";",
        "",
        "const root = path.resolve(fileURLToPath(new URL(\".\", import.meta.url)), \"..\");",
        "const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };",
        "const label = arg(\"label\");",
        "const base = arg(\"base-url\", \"http://localhost:3000\");",
        "const theme = arg(\"theme\", \"dark\");",
        "if (!label) { console.error(\"Missing --label before|after\"); process.exit(1); }",
        "",
        "let chromium;",
        "try { ({ chromium } = await import(\"playwright\")); }",
        "catch { console.error(\"Playwright is not installed. See the header of this file.\"); process.exit(1); }",
        "",
        "const themesSrc = fs.readFileSync(path.join(root, \"content/marketing/themes.ts\"), \"utf8\");",
        "const slugs = [...themesSrc.matchAll(/slug:\\s*[\"'`]([\\w-]+)[\"'`]/g)].map((m) => m[1]);",
        "const routes = [",
        "  \"/\", \"/features\", \"/pricing\", \"/themes\", \"/about\", \"/contact\",",
        "  \"/legal/privacy\", \"/legal/terms\", \"/legal/refunds\", \"/legal/cookies\",",
        "  ...slugs.map((s) => `/themes/${s}`),",
        "  ...(slugs[0] ? [`/demo/${slugs[0]}`, `/demo/${slugs[0]}/products`] : []),",
        "];",
        "const widths = [375, 768, 1440];",
        "const outDir = path.join(root, \"REDESIGNSCRIPTS\", \".baseline\", label);",
        "fs.mkdirSync(outDir, { recursive: true });",
        "",
        "const browser = await chromium.launch();",
        "let n = 0;",
        "for (const width of widths) {",
        "  const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: \"reduce\", colorScheme: theme });",
        "  await ctx.addInitScript((t) => { try { localStorage.setItem(\"theme\", t); } catch {} }, theme);",
        "  const page = await ctx.newPage();",
        "  for (const route of routes) {",
        "    const name = (route === \"/\" ? \"home\" : route.slice(1).replace(/\\//g, \"_\")) + `__${width}.png`;",
        "    try {",
        "      const res = await page.goto(base + route, { waitUntil: \"networkidle\", timeout: 45000 });",
        "      await page.screenshot({ path: path.join(outDir, name), fullPage: true });",
        "      console.log(`${res?.status() ?? \"?\"}  ${route}  ${width}`);",
        "      n++;",
        "    } catch (e) { console.log(`ERR  ${route}  ${width}  ${String(e.message).split(\"\\n\")[0]}`); }",
        "  }",
        "  await ctx.close();",
        "}",
        "await browser.close();",
        "console.log(`captured ${n} screenshots in ${path.relative(root, outDir)}`);",
        ""
      ]
    }
  ]
};

const NOTES = [
  "Scope: apps/storefront only. Tokens live in apps/storefront/styles, guards in apps/storefront/scripts.",
  "Not created in this run: packages/design-system tokens and shared primitives (out of scope by owner decision).",
  "Zinc values are the published shadcn Zinc theme, not CLI-generated. Diff against `shadcn init --base-color zinc`.",
  "defaultTheme in app-providers.tsx is unchanged: the root layout is shared with tenant and demo routes.",
  "Font and colour tokens apply app-wide, including app/(store). Compare the demo-route screenshots before and after.",
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const toLF = (s) => s.replace(/\r\n/g, "\n");
const lines = (a) => a.join("\n");
const abs = (rel) => path.join(ROOT, ...rel.split("/"));
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const flag = process.argv.slice(2).find((a) => ["--dry-run", "--apply", "--verify", "--revert"].includes(a));

function plan() {
  const rows = [];
  for (const f of M.modify) {
    const file = abs(f.rel);
    const row = { rel: f.rel, kind: "modify", matched: 0, total: f.edits.length, status: "", out: null, raw: null };
    if (!fs.existsSync(file)) { row.status = "BLOCKED: file not found"; rows.push(row); continue; }
    const raw = fs.readFileSync(file, "utf8");
    row.raw = raw;
    const norm = toLF(raw);
    const h = sha(norm);
    if (h === f.afterSha) { row.matched = row.total; row.status = "already applied"; rows.push(row); continue; }
    let text = norm;
    const bad = [];
    for (const e of f.edits) {
      const before = lines(e.before);
      const n = count(norm, before);
      if (n === e.expect) row.matched++; else bad.push(`${e.name} (found ${n}, expected ${e.expect})`);
    }
    if (bad.length) { row.status = "BLOCKED: anchor missing: " + bad.join("; "); rows.push(row); continue; }
    if (h !== f.beforeSha) { row.status = `BLOCKED: file differs from the expected copy (sha256 ${h.slice(0, 12)}, expected ${f.beforeSha.slice(0, 12)})`; rows.push(row); continue; }
    for (const e of f.edits) text = text.split(lines(e.before)).join(lines(e.after));
    if (sha(text) !== f.afterSha) { row.status = "BLOCKED: computed result does not match its checksum"; rows.push(row); continue; }
    row.out = raw.includes("\r\n") ? text.replace(/\n/g, "\r\n") : text;
    row.status = "ready";
    rows.push(row);
  }
  for (const f of M.create) {
    const file = abs(f.rel);
    const content = lines(f.lines);
    const row = { rel: f.rel, kind: "create", matched: 0, total: 1, status: "", out: content };
    if (fs.existsSync(file)) {
      if (sha(toLF(fs.readFileSync(file, "utf8"))) === sha(content)) { row.matched = 1; row.status = "already applied"; }
      else row.status = "BLOCKED: exists with different content";
    } else { row.matched = 1; row.status = "ready"; }
    rows.push(row);
  }
  const applied = rows.filter((r) => r.status === "already applied").length;
  if (applied > 0 && applied < rows.length && !rows.some((r) => r.status.startsWith("BLOCKED"))) {
    rows.forEach((r) => { if (r.status === "ready") r.status = "BLOCKED: partially applied (other files are already applied)"; });
  }
  return rows;
}

function report(title, rows) {
  console.log(`patch_redesign_${PHASE}  ${title}`);
  NOTES.forEach((n) => console.log("NOTE  " + n));
  const w = Math.max(...rows.map((r) => r.rel.length));
  for (const r of rows) {
    console.log(`${r.rel.padEnd(w)}  ${r.kind === "create" ? "new file " : "anchors  "}${r.matched} of ${r.total}  ${r.status}`);
  }
  const blocked = rows.some((r) => r.status.startsWith("BLOCKED"));
  console.log(blocked ? "RESULT: BLOCKED" : "RESULT: OK");
  return !blocked;
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".p0tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function apply() {
  const rows = plan();
  if (rows.every((r) => r.status === "already applied")) { report("--apply", rows); return true; }
  if (rows.some((r) => r.status.startsWith("BLOCKED"))) { report("--apply", rows); return false; }
  // Pass 2: back up, then write. Roll back on any error.
  fs.mkdirSync(BACKUP, { recursive: true });
  const manifest = { phase: PHASE, modified: [], created: [] };
  const todo = rows.filter((r) => r.status === "ready");
  try {
    for (const r of todo) {
      if (r.kind === "modify") {
        const dest = path.join(BACKUP, ...r.rel.split("/"));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, r.raw);
        manifest.modified.push(r.rel);
      } else manifest.created.push(r.rel);
    }
    writeAtomic(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
    for (const r of todo) writeAtomic(abs(r.rel), r.out);
    todo.forEach((r) => (r.status = "applied"));
  } catch (err) {
    console.log("ERROR during write: " + err.message + ". Rolling back.");
    restore(manifest);
    todo.forEach((r) => (r.status = "BLOCKED: write failed, rolled back"));
  }
  return report("--apply", rows);
}

function restore(manifest) {
  for (const rel of manifest.modified) {
    const src = path.join(BACKUP, ...rel.split("/"));
    if (fs.existsSync(src)) writeAtomic(abs(rel), fs.readFileSync(src));
  }
  for (const rel of manifest.created) {
    const f = abs(rel);
    if (fs.existsSync(f)) fs.rmSync(f);
    const dir = path.dirname(f);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

function revert() {
  console.log(`patch_redesign_${PHASE}  --revert`);
  if (!fs.existsSync(MANIFEST_FILE)) { console.log("Nothing to revert: no backup manifest."); console.log("RESULT: OK"); return true; }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  restore(manifest);
  fs.renameSync(MANIFEST_FILE, path.join(BACKUP, "manifest.reverted.json"));
  manifest.modified.forEach((r) => console.log(`restored  ${r}`));
  manifest.created.forEach((r) => console.log(`removed   ${r}`));
  console.log("RESULT: OK");
  return true;
}

function node(script, args = []) {
  const file = path.join(SF, "scripts", script);
  if (!fs.existsSync(file)) return { ok: false, out: "missing " + script };
  const r = spawnSync(process.execPath, [file, ...args], { cwd: SF, encoding: "utf8" });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
}

function verify() {
  console.log(`patch_redesign_${PHASE}  --verify`);
  let ok = true;
  const line = (name, pass, detail = "") => {
    if (pass === false) ok = false;
    console.log(`${pass === null ? "SKIP" : pass ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  };
  const rows = plan();
  for (const r of rows) line(`applied: ${r.rel}`, r.status === "already applied", r.status === "already applied" ? "" : r.status);
  const guards = [
    ["check:tokens", "check-tokens.mjs", []],
    ["check:classes", "check-classes.mjs", []],
    ["check:contrast", "check-contrast.mjs", []],
    ["check:flat (report-only)", "check-flat.mjs", []],
    ["check:scope", "check-scope.mjs", [PHASE]],
  ];
  for (const [name, script, args] of guards) {
    const r = node(script, args);
    line(name, r.ok, r.ok ? r.out.split("\n").pop() : "\n" + r.out.split("\n").slice(-12).join("\n"));
  }
  const tsc = [path.join(SF, "node_modules", "typescript", "bin", "tsc"), path.join(ROOT, "node_modules", "typescript", "bin", "tsc")].find((p) => fs.existsSync(p));
  if (!tsc) line("type-check", null, "dependencies are not installed (run pnpm install, then pnpm --filter @markaz/storefront type-check)");
  else {
    const r = spawnSync(process.execPath, [tsc, "--noEmit", "-p", path.join(SF, "tsconfig.json")], { cwd: SF, encoding: "utf8" });
    line("type-check", r.status === 0, r.status === 0 ? "" : "\n" + (r.stdout || r.stderr).split("\n").slice(0, 15).join("\n"));
  }
  console.log(ok ? "RESULT: OK" : "RESULT: BLOCKED");
  return ok;
}

let ok;
if (flag === "--dry-run") { const rows = plan(); ok = report("--dry-run (nothing written)", rows); }
else if (flag === "--apply") ok = apply();
else if (flag === "--verify") ok = verify();
else if (flag === "--revert") ok = revert();
else { console.log("Usage: node patch_redesign_P0.mjs --dry-run | --apply | --verify | --revert"); ok = false; }
process.exit(ok ? 0 : 1);
