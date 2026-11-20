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
  // Sprint 4 EP-08: account emails (D-093).
  'password_reset',
  'password_changed',
  'email_verify',
  'email_change_verify',
  // Sprint 4 EP-04.US06: the seller's store went live.
  'store_live',
  // Sprint 4 EP-05.US03: the platform paid the seller, or took a payment back.
  'payout_paid',
  'payout_voided',
  // Sprint 4 EP-07.US04: a store's broadcast to its customers (the seller's own subject and message).
  'broadcast',
  // Sprint 5 EP-13: a shopper asked for a return (to the seller), and the seller's decision (to the shopper).
  'return_requested_seller',
  'return_approved_customer',
  'return_rejected_customer',
  // Sprint 5 EP-21: a shopper left a review (to the seller). EP-28: the optional email about a cart left behind (to the shopper).
  'review_received_seller',
  'abandoned_cart',
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
  'appName',
  'actionLink',
  'validFor',
  'newEmail',
  'storefrontLink',
  'payoutAmount',
  'payoutMethod',
  'payoutReference',
  'voidReason',
  'broadcastSubject',
  'broadcastMessage',
  'unsubscribeLink',
  'emailFooter',
  // Sprint 5 EP-13: the return's number, and the seller's reason when a return is declined.
  'returnNumber',
  'returnReason',
  // Sprint 5 EP-21: the rating ("5 out of 5") and the text of a new review, for the seller's email.
  'reviewRating',
  'reviewText',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string>>;

/** Variables whose value is several lines (one order line each); HTML keeps the line breaks. */
const MULTILINE: ReadonlySet<string> = new Set(['items', 'broadcastMessage', 'emailFooter', 'reviewText']);
/** Variables that are links: in HTML they become a link, and only http(s) is accepted. */
const LINKS: ReadonlySet<string> = new Set(['trackingLink', 'dashboardLink', 'actionLink', 'storefrontLink', 'unsubscribeLink']);

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
  password_reset: {
    variables: ['appName', 'customerName', 'actionLink', 'validFor'],
    subject: '{{appName}}: reset your password',
    en: [
      'Hi {{customerName}},',
      '',
      'Someone asked to reset the password of your {{appName}} account. Open this link to choose a new one:',
      '{{actionLink}}',
      '',
      'The link works once and for {{validFor}}. If you did not ask for it, ignore this email: your password stays as it is.',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      'آپ کے {{appName}} اکاؤنٹ کا پاس ورڈ بدلنے کی درخواست آئی ہے۔ نیا پاس ورڈ رکھنے کے لیے یہ لنک کھولیں:',
      '{{actionLink}}',
      'یہ لنک صرف ایک بار اور {{validFor}} تک چلے گا۔ اگر یہ درخواست آپ نے نہیں کی تو اس ای میل کو نظر انداز کریں۔',
    ],
    whatsapp: 'Reset your {{appName}} password: {{actionLink}}\nپاس ورڈ بدلنے کا لنک: {{actionLink}}',
  },
  password_changed: {
    variables: ['appName', 'customerName', 'actionLink'],
    subject: '{{appName}}: your password was changed',
    en: [
      'Hi {{customerName}},',
      '',
      'The password of your {{appName}} account was just changed, and every other device was signed out.',
      '',
      'If this was not you, reset your password now: {{actionLink}}',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      'آپ کے {{appName}} اکاؤنٹ کا پاس ورڈ ابھی بدلا گیا ہے اور باقی تمام ڈیوائسز سے سائن آؤٹ کر دیا گیا ہے۔',
      'اگر یہ آپ نے نہیں کیا تو ابھی پاس ورڈ بدلیں: {{actionLink}}',
    ],
    whatsapp: 'Your {{appName}} password was changed. Not you? {{actionLink}}\nآپ کا پاس ورڈ بدل دیا گیا ہے۔',
  },
  email_verify: {
    variables: ['appName', 'customerName', 'actionLink', 'validFor'],
    subject: '{{appName}}: confirm your email address',
    en: [
      'Hi {{customerName}},',
      '',
      'Welcome to {{appName}}. Confirm your email address to put your store live and to receive payouts:',
      '{{actionLink}}',
      '',
      'The link works once and for {{validFor}}.',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      '{{appName}} میں خوش آمدید۔ اپنا اسٹور لائیو کرنے اور ادائیگیاں وصول کرنے کے لیے اپنا ای میل کنفرم کریں:',
      '{{actionLink}}',
      'یہ لنک صرف ایک بار اور {{validFor}} تک چلے گا۔',
    ],
    whatsapp: 'Confirm your {{appName}} email: {{actionLink}}\nاپنا ای میل کنفرم کریں: {{actionLink}}',
  },
  email_change_verify: {
    variables: ['appName', 'customerName', 'newEmail', 'actionLink', 'validFor'],
    subject: '{{appName}}: confirm your new email address',
    en: [
      'Hi {{customerName}},',
      '',
      'You asked to sign in to {{appName}} with {{newEmail}} from now on. Open this link to confirm it:',
      '{{actionLink}}',
      '',
      'Until you do, your old email stays your login. The link works once and for {{validFor}}.',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      'آپ نے {{appName}} میں آئندہ {{newEmail}} سے سائن اِن کرنے کی درخواست کی ہے۔ کنفرم کرنے کے لیے یہ لنک کھولیں:',
      '{{actionLink}}',
      'جب تک آپ کنفرم نہیں کرتے، پرانا ای میل ہی آپ کا لاگ اِن رہے گا۔ یہ لنک صرف ایک بار اور {{validFor}} تک چلے گا۔',
    ],
    whatsapp: 'Confirm {{newEmail}} for {{appName}}: {{actionLink}}\nنیا ای میل کنفرم کریں: {{actionLink}}',
  },
  store_live: {
    variables: ['storeName', 'storefrontLink', 'dashboardLink'],
    subject: '{{storeName}} is live',
    en: [
      'Congratulations! {{storeName}} is now live and open to shoppers.',
      '',
      'Your store: {{storefrontLink}}',
      'Your dashboard: {{dashboardLink}}',
    ],
    ur: [
      'مبارک ہو! {{storeName}} اب لائیو ہے اور خریداروں کے لیے کھلا ہے۔',
      'آپ کا اسٹور: {{storefrontLink}}',
      'آپ کا ڈیش بورڈ: {{dashboardLink}}',
    ],
    whatsapp: '{{storeName}} is live: {{storefrontLink}}\nآپ کا اسٹور لائیو ہو گیا ہے۔',
  },
  return_requested_seller: {
    variables: ['storeName', 'orderNumber', 'returnNumber', 'customerName', 'dashboardLink'],
    subject: 'Return request {{returnNumber}} for order {{orderNumber}}',
    en: [
      '{{customerName}} asked to return items from order {{orderNumber}} on {{storeName}}.',
      '',
      'Return: {{returnNumber}}',
      '',
      'Review it and approve or decline: {{dashboardLink}}',
    ],
    ur: [
      '{{customerName}} نے {{storeName}} کے آرڈر {{orderNumber}} کی اشیاء واپس کرنے کی درخواست کی ہے۔',
      'ریٹرن نمبر: {{returnNumber}}',
      'دیکھیں اور منظور یا مسترد کریں: {{dashboardLink}}',
    ],
    whatsapp: 'Return request {{returnNumber}} for order {{orderNumber}} on {{storeName}}. {{dashboardLink}}\nواپسی کی نئی درخواست آئی ہے۔',
  },
  return_approved_customer: {
    variables: ['storeName', 'customerName', 'orderNumber', 'returnNumber'],
    subject: '{{storeName}}: your return {{returnNumber}} is approved',
    en: [
      'Hi {{customerName}},',
      '',
      '{{storeName}} approved your return {{returnNumber}} for order {{orderNumber}}. The store will contact you about sending the items back.',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      '{{storeName}} نے آپ کے آرڈر {{orderNumber}} کی واپسی {{returnNumber}} منظور کر لی ہے۔ سامان واپس بھیجنے کے بارے میں اسٹور آپ سے رابطہ کرے گا۔',
    ],
    whatsapp: 'Hi {{customerName}}, {{storeName}} approved your return {{returnNumber}} for order {{orderNumber}}.\nآپ کی واپسی منظور ہو گئی ہے۔',
  },
  return_rejected_customer: {
    variables: ['storeName', 'customerName', 'orderNumber', 'returnNumber', 'returnReason'],
    subject: '{{storeName}}: your return {{returnNumber}} was not approved',
    en: [
      'Hi {{customerName}},',
      '',
      '{{storeName}} could not approve your return {{returnNumber}} for order {{orderNumber}}.',
      '',
      'Reason: {{returnReason}}',
    ],
    ur: [
      '{{customerName}}، السلام علیکم،',
      '{{storeName}} آپ کے آرڈر {{orderNumber}} کی واپسی {{returnNumber}} منظور نہیں کر سکا۔',
      'وجہ: {{returnReason}}',
    ],
    whatsapp: 'Hi {{customerName}}, {{storeName}} could not approve return {{returnNumber}} for order {{orderNumber}}. Reason: {{returnReason}}\nآپ کی واپسی منظور نہیں ہوئی۔',
  },
  review_received_seller: {
    variables: ['storeName', 'productName', 'customerName', 'reviewRating', 'reviewText', 'dashboardLink'],
    subject: 'New review for {{productName}}: {{reviewRating}}',
    en: [
      '{{customerName}} reviewed {{productName}} on {{storeName}}: {{reviewRating}}.',
      '',
      '{{reviewText}}',
      '',
      'Read it and reply: {{dashboardLink}}',
    ],
    ur: [
      '{{customerName}} نے {{storeName}} پر {{productName}} کا ریویو دیا ہے: {{reviewRating}}۔',
      '{{reviewText}}',
      'دیکھیں اور جواب دیں: {{dashboardLink}}',
    ],
    whatsapp: 'New review for {{productName}} on {{storeName}}: {{reviewRating}}. {{dashboardLink}}\nنیا ریویو آیا ہے۔',
  },
  abandoned_cart: {
    variables: ['storeName', 'items', 'total', 'storefrontLink', 'unsubscribeLink'],
    subject: '{{storeName}}: you left something in your cart',
    en: [
      'You left these items in your cart at {{storeName}}:',
      '',
      '{{items}}',
      '',
      'Total: {{total}}',
      '',
      'Pick up where you left off: {{storefrontLink}}',
      '',
      'You get this email because you left a cart at {{storeName}} and agreed to be messaged about it. To stop these emails: {{unsubscribeLink}}',
    ],
    ur: [
      'آپ نے {{storeName}} پر اپنی کارٹ میں یہ اشیاء چھوڑی ہیں:',
      '{{items}}',
      'کل رقم: {{total}}',
      'وہیں سے جاری رکھیں: {{storefrontLink}}',
      'ایسی ای میلز بند کرنے کے لیے یہ لنک کھولیں: {{unsubscribeLink}}',
    ],
    whatsapp: 'You left items in your cart at {{storeName}}: {{storefrontLink}}\nآپ کی کارٹ میں سامان رہ گیا ہے۔',
  },
  payout_paid: {
    variables: ['storeName', 'payoutAmount', 'payoutMethod', 'payoutReference', 'dashboardLink'],
    subject: '{{storeName}}: we sent you {{payoutAmount}}',
    en: [
      'Good news! Markazify has paid out your earnings from {{storeName}}.',
      '',
      'Amount: {{payoutAmount}}',
      'Sent by: {{payoutMethod}}',
      'Reference: {{payoutReference}}',
      '',
      'See your earnings: {{dashboardLink}}',
    ],
    ur: [
      'خوشخبری! Markazify نے {{storeName}} کی کمائی آپ کو ادا کر دی ہے۔',
      'رقم: {{payoutAmount}}',
      'ذریعہ: {{payoutMethod}}',
      'حوالہ نمبر: {{payoutReference}}',
      'اپنی کمائی دیکھیں: {{dashboardLink}}',
    ],
    whatsapp: 'Markazify paid {{payoutAmount}} to you for {{storeName}} ({{payoutMethod}}, ref {{payoutReference}}). {{dashboardLink}}\nآپ کو {{payoutAmount}} ادا کر دیے گئے ہیں۔',
  },
  payout_voided: {
    variables: ['storeName', 'payoutAmount', 'voidReason', 'dashboardLink'],
    subject: '{{storeName}}: a payout of {{payoutAmount}} was cancelled',
    en: [
      'The payout of {{payoutAmount}} for {{storeName}} was cancelled by Markazify.',
      '',
      'Reason: {{voidReason}}',
      '',
      'The amount is back in your balance and will be included in your next payout. See your earnings: {{dashboardLink}}',
    ],
    ur: [
      '{{storeName}} کی {{payoutAmount}} کی ادائیگی Markazify نے منسوخ کر دی ہے۔',
      'وجہ: {{voidReason}}',
      'یہ رقم آپ کے بیلنس میں واپس آ گئی ہے اور اگلی ادائیگی میں شامل ہو گی۔ اپنی کمائی دیکھیں: {{dashboardLink}}',
    ],
    whatsapp: 'The payout of {{payoutAmount}} for {{storeName}} was cancelled: {{voidReason}}. {{dashboardLink}}\nآپ کی ادائیگی منسوخ کر دی گئی ہے۔',
  },
  broadcast: {
    variables: ['storeName', 'broadcastSubject', 'broadcastMessage', 'emailFooter', 'unsubscribeLink'],
    subject: '{{broadcastSubject}}',
    en: [
      '{{broadcastMessage}}',
      '',
      '{{emailFooter}}',
      '',
      'You get this email because you ordered from {{storeName}}. To stop receiving these emails: {{unsubscribeLink}}',
    ],
    ur: [
      'یہ پیغام {{storeName}} کی طرف سے ہے، کیونکہ آپ نے وہاں سے آرڈر کیا تھا۔',
      'ایسی ای میلز بند کرنے کے لیے یہ لنک کھولیں: {{unsubscribeLink}}',
    ],
    whatsapp: '{{broadcastMessage}}\n{{storeName}}',
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
export interface RenderOptions {
  /**
   * The store's own footer (EP-07.US02.T02), added at the end of the email: plain text, escaped in HTML, line breaks kept.
   * Only the order emails to customers pass it.
   */
  footer?: string | null;
}

export function renderTemplate(name: TemplateName, vars: TemplateVars, options: RenderOptions = {}): RenderedTemplate {
  const template = TEMPLATES[name];
  if (!template) throw new TemplateError('unknown template ' + String(name));
  const values = requireValues(name, template, vars);

  const subject = fillText(template.subject, values, true).slice(0, 200);
  const footer = (options.footer ?? '').trim();
  const baseText = [...template.en.map((line) => fillText(line, values, false)), '', '---', '', ...template.ur.map((line) => fillText(line, values, false))].join('\n');
  const text = footer ? baseText + '\n\n---\n' + footer : baseText;
  const footerHtml = footer ? '<div dir="auto" style="margin-top:16px;color:#555">' + escapeHtml(footer).replace(/\r?\n/g, '<br>') + '</div>' : '';
  const html =
    '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
    htmlBlock(template.en, values, false) +
    '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
    htmlBlock(template.ur, values, true) +
    footerHtml +
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
