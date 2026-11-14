/**
 * EP-07.US02.T01: every system message in one place, keyed by name. Each template is bilingual (English first, Urdu
 * below) and has a plain-text email, an HTML email and a short WhatsApp text. Values are named ({{orderNumber}}) and
 * escaped in HTML. A template may only use the variables it declares (templateProblems() and its test enforce this),
 * and rendering refuses a declared variable that has no value, so a message can never go out with a hole in it.
 *
 * Pure: no Node or browser API, so the WhatsApp texts can also be built in a browser bundle.
 */

export const TEMPLATE_NAMES = [
  'order_placed_customer',
  'order_placed_seller',
  'order_confirmed',
  'order_dispatched',
  'order_delivered',
  'order_cancelled',
  'low_stock_seller',
  'out_of_stock_seller',
] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/** Values a template can be given. Money is formatted by the caller (formatRupees), so templates never compute. */
export const TEMPLATE_VARIABLES = [
  'storeName',
  'customerName',
  'orderNumber',
  'items',
  'total',
  'paymentMethod',
  'trackingLink',
  'courier',
  'trackingNumber',
  'city',
  'dashboardLink',
  'productName',
  'stockLeft',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

/** Variables whose value is several lines (one order line each); HTML keeps the line breaks. */
const MULTILINE: ReadonlySet<string> = new Set(['items']);
/** Variables that are links: in HTML they become a link, and only http(s) is accepted. */
const LINKS: ReadonlySet<string> = new Set(['trackingLink', 'dashboardLink']);

export interface TemplateDefinition {
  /** The variables the texts may use; every one must have a value when rendering. */
  variables: readonly TemplateVariable[];
  subject: string;
  /** Lines of the English part. An empty string is a blank line. */
  en: readonly string[];
  /** Lines of the Urdu part, shown below the English one. */
  ur: readonly string[];
  /** One short WhatsApp text (English, then Urdu). */
  whatsapp: string;
}

export const TEMPLATES: Record<TemplateName, TemplateDefinition> = {
  order_placed_customer: {
    variables: ['storeName', 'customerName', 'orderNumber', 'items', 'total', 'paymentMethod', 'trackingLink'],
    subject: '{{storeName}}: we received your order {{orderNumber}}',
    en: [
      'Hi {{customerName}},',
      '',
      'Thank you for your order with {{storeName}}. Your order number is {{orderNumber}}.',
      '',
      '{{items}}',
      '',
      'Total: {{total}}',
      'Payment: {{paymentMethod}}',
      '',
      'Track your order: {{trackingLink}}',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      '{{storeName}} سے آرڈر کرنے کا شکریہ۔ آپ کا آرڈر نمبر {{orderNumber}} ہے۔',
      'کل رقم: {{total}}',
      'ادائیگی: {{paymentMethod}}',
      'اپنا آرڈر یہاں دیکھیں: {{trackingLink}}',
    ],
    whatsapp: 'Hi {{customerName}}, your {{storeName}} order {{orderNumber}} ({{total}}) is received. Track it: {{trackingLink}}\nآپ کا آرڈر {{orderNumber}} موصول ہو گیا ہے۔',
  },
  order_placed_seller: {
    variables: ['storeName', 'orderNumber', 'customerName', 'items', 'total', 'paymentMethod', 'city', 'dashboardLink'],
    subject: 'New order {{orderNumber}} for {{storeName}}',
    en: [
      'You have a new order on {{storeName}}.',
      '',
      'Order: {{orderNumber}}',
      'Customer: {{customerName}}, {{city}}',
      'Payment: {{paymentMethod}}',
      'Total: {{total}}',
      '',
      '{{items}}',
      '',
      'Open the order: {{dashboardLink}}',
    ],
    ur: [
      '{{storeName}} پر نیا آرڈر آیا ہے۔',
      'آرڈر نمبر: {{orderNumber}}',
      'گاہک: {{customerName}}، {{city}}',
      'کل رقم: {{total}}',
      'آرڈر دیکھیں: {{dashboardLink}}',
    ],
    whatsapp: 'New order {{orderNumber}} on {{storeName}}: {{total}} ({{paymentMethod}}). {{dashboardLink}}\nنیا آرڈر {{orderNumber}} آیا ہے۔',
  },
  order_confirmed: {
    variables: ['storeName', 'customerName', 'orderNumber', 'trackingLink'],
    subject: '{{storeName}}: your order {{orderNumber}} is confirmed',
    en: [
      'Hi {{customerName}},',
      '',
      '{{storeName}} has confirmed your order {{orderNumber}}. We will let you know when it is on its way.',
      '',
      'Track your order: {{trackingLink}}',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      '{{storeName}} نے آپ کا آرڈر {{orderNumber}} کنفرم کر دیا ہے۔ روانگی پر آپ کو اطلاع دی جائے گی۔',
      'اپنا آرڈر یہاں دیکھیں: {{trackingLink}}',
    ],
    whatsapp: 'Hi {{customerName}}, your {{storeName}} order {{orderNumber}} is confirmed. Track it: {{trackingLink}}\nآپ کا آرڈر {{orderNumber}} کنفرم ہو گیا ہے۔',
  },
  order_dispatched: {
    variables: ['storeName', 'customerName', 'orderNumber', 'courier', 'trackingNumber', 'trackingLink'],
    subject: '{{storeName}}: your order {{orderNumber}} is on its way',
    en: [
      'Hi {{customerName}},',
      '',
      'Your order {{orderNumber}} from {{storeName}} has been handed to {{courier}}.',
      'Tracking number: {{trackingNumber}}',
      '',
      'Track your order: {{trackingLink}}',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      'آپ کا آرڈر {{orderNumber}} {{courier}} کے حوالے کر دیا گیا ہے۔',
      'ٹریکنگ نمبر: {{trackingNumber}}',
      'اپنا آرڈر یہاں دیکھیں: {{trackingLink}}',
    ],
    whatsapp: 'Hi {{customerName}}, your {{storeName}} order {{orderNumber}} is on its way with {{courier}}, tracking number {{trackingNumber}}. {{trackingLink}}\nآپ کا آرڈر {{orderNumber}} روانہ ہو گیا ہے۔',
  },
  order_delivered: {
    variables: ['storeName', 'customerName', 'orderNumber'],
    subject: '{{storeName}}: your order {{orderNumber}} was delivered',
    en: ['Hi {{customerName}},', '', 'Your order {{orderNumber}} from {{storeName}} was delivered. Thank you for shopping with us.'],
    ur: ['{{customerName}}، السلام علیکم،', 'آپ کا آرڈر {{orderNumber}} پہنچا دیا گیا ہے۔ {{storeName}} سے خریداری کا شکریہ۔'],
    whatsapp: 'Hi {{customerName}}, your {{storeName}} order {{orderNumber}} was delivered. Thank you!\nآپ کا آرڈر {{orderNumber}} پہنچ گیا ہے۔ شکریہ!',
  },
  order_cancelled: {
    variables: ['storeName', 'customerName', 'orderNumber'],
    subject: '{{storeName}}: your order {{orderNumber}} was cancelled',
    en: ['Hi {{customerName}},', '', 'Your order {{orderNumber}} from {{storeName}} was cancelled. If you did not expect this, please contact the store.'],
    ur: ['{{customerName}}، السلام علیکم،', 'آپ کا آرڈر {{orderNumber}} منسوخ کر دیا گیا ہے۔ کسی سوال کے لیے {{storeName}} سے رابطہ کریں۔'],
    whatsapp: 'Hi {{customerName}}, your {{storeName}} order {{orderNumber}} was cancelled.\nآپ کا آرڈر {{orderNumber}} منسوخ ہو گیا ہے۔',
  },
  low_stock_seller: {
    variables: ['storeName', 'productName', 'stockLeft', 'dashboardLink'],
    subject: 'Low stock on {{storeName}}: {{productName}}',
    en: ['Only {{stockLeft}} left of {{productName}} on {{storeName}}.', '', 'Restock it here: {{dashboardLink}}'],
    ur: ['{{storeName}} پر {{productName}} کے صرف {{stockLeft}} باقی ہیں۔', 'اسٹاک یہاں بڑھائیں: {{dashboardLink}}'],
    whatsapp: 'Only {{stockLeft}} left of {{productName}} on {{storeName}}. {{dashboardLink}}\n{{productName}} کا اسٹاک کم ہے۔',
  },
  out_of_stock_seller: {
    variables: ['storeName', 'productName', 'dashboardLink'],
    subject: 'Out of stock on {{storeName}}: {{productName}}',
    en: ['{{productName}} is out of stock on {{storeName}}. Shoppers cannot order it until you restock.', '', 'Restock it here: {{dashboardLink}}'],
    ur: ['{{storeName}} پر {{productName}} کا اسٹاک ختم ہو گیا ہے۔', 'اسٹاک یہاں بڑھائیں: {{dashboardLink}}'],
    whatsapp: '{{productName}} is out of stock on {{storeName}}. {{dashboardLink}}\n{{productName}} کا اسٹاک ختم ہو گیا ہے۔',
  },
};

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

/** Escapes text for an HTML body or attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Every {{name}} a string uses. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

/**
 * What is wrong with the templates: a placeholder that is not a known variable, or not declared by its template. Empty
 * when all is well. The test suite fails on any entry, so a typo in a template is caught before it is sent.
 */
export function templateProblems(templates: Record<string, TemplateDefinition> = TEMPLATES): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const problems: string[] = [];
  for (const [name, template] of Object.entries(templates)) {
    const declared = new Set<string>(template.variables);
    for (const variable of template.variables) {
      if (!known.has(variable)) problems.push(name + ': declares unknown variable ' + variable);
    }
    for (const text of [template.subject, ...template.en, ...template.ur, template.whatsapp]) {
      for (const used of placeholdersOf(text)) {
        if (!known.has(used)) problems.push(name + ': uses unknown variable ' + used);
        else if (!declared.has(used)) problems.push(name + ': uses undeclared variable ' + used);
      }
    }
  }
  return problems;
}

export function isTemplateName(value: unknown): value is TemplateName {
  return typeof value === 'string' && (TEMPLATE_NAMES as readonly string[]).includes(value);
}

/** One line of text: controls become spaces, so a value cannot add lines or headers to a subject. */
function singleLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
}

function requireValues(name: TemplateName, template: TemplateDefinition, vars: TemplateVars): Record<string, string> {
  const values: Record<string, string> = {};
  for (const variable of template.variables) {
    const value = vars[variable];
    if (typeof value !== 'string' || value.trim() === '') throw new TemplateError(name + ': missing value for ' + variable);
    values[variable] = value;
  }
  return values;
}

function fillText(text: string, values: Record<string, string>, oneLine: boolean): string {
  return text.replace(PLACEHOLDER, (_whole, variable: string) => {
    const value = values[variable] ?? '';
    return oneLine ? singleLine(value) : value;
  });
}

function htmlValue(variable: string, value: string): string {
  if (LINKS.has(variable)) {
    const href = value.trim();
    if (/^https?:\/\//i.test(href)) return '<a href="' + escapeHtml(href) + '">' + escapeHtml(href) + '</a>';
    return escapeHtml(href);
  }
  const escaped = escapeHtml(value);
  return MULTILINE.has(variable) ? escaped.replace(/\r?\n/g, '<br>') : escaped;
}

function fillHtml(text: string, values: Record<string, string>): string {
  // Split on placeholders so the template's own text is escaped too and a value is escaped exactly once.
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const start = match.index ?? last;
    out += escapeHtml(text.slice(last, start));
    out += htmlValue(match[1]!, values[match[1]!] ?? '');
    last = start + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

function htmlBlock(lines: readonly string[], values: Record<string, string>, rtl: boolean): string {
  const paragraphs = lines.filter((line) => line !== '').map((line) => '<p style="margin:0 0 12px">' + fillHtml(line, values) + '</p>');
  const dir = rtl ? ' dir="rtl" lang="ur" style="text-align:right"' : ' dir="ltr" lang="en"';
  return '<div' + dir + '>' + paragraphs.join('') + '</div>';
}

export interface RenderedTemplate {
  subject: string;
  text: string;
  html: string;
  whatsapp: string;
}

/**
 * Renders one template. Throws TemplateError for an unknown name or a declared variable without a value; the outbox
 * catches it, so a caller is never failed by a message. Values that are not declared by the template are ignored.
 */
export function renderTemplate(name: TemplateName, vars: TemplateVars): RenderedTemplate {
  const template = TEMPLATES[name];
  if (!template) throw new TemplateError('unknown template ' + String(name));
  const values = requireValues(name, template, vars);

  const subject = fillText(template.subject, values, true).slice(0, 200);
  const text = [...template.en.map((line) => fillText(line, values, false)), '', '---', '', ...template.ur.map((line) => fillText(line, values, false))].join('\n');
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    htmlBlock(template.en, values, false) +
    '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
    htmlBlock(template.ur, values, true) +
    '</body></html>';
  const whatsapp = fillText(template.whatsapp, values, false);
  return { subject, text, html, whatsapp };
}

/** Whole rupees as the platform prints them: "Rs. 2,600". */
export function formatRupees(amount: number): string {
  const whole = Number.isFinite(amount) ? Math.round(amount) : 0;
  return 'Rs. ' + whole.toLocaleString('en-US');
}

export interface ItemLine {
  title: string;
  variantTitle?: string | null;
  quantity: number;
  unitPrice: number;
}

/** The items block of the order emails: one line per item, "Title (Variant) x 2 - Rs. 2,400". */
export function formatItems(items: readonly ItemLine[]): string {
  return items
    .map((item) => {
      const variant = item.variantTitle && item.variantTitle !== 'Default' ? ' (' + item.variantTitle + ')' : '';
      return item.title + variant + ' x ' + item.quantity + ' - ' + formatRupees(item.unitPrice * item.quantity);
    })
    .join('\n');
}

/** How a payment method reads in a message. */
export function paymentMethodLabel(method: unknown): string {
  if (method === 'card') return 'Card';
  if (method === 'cod') return 'Cash on delivery';
  return 'Not set';
}
