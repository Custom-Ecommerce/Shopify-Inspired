import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES,
  TEMPLATE_NAMES,
  TemplateError,
  escapeHtml,
  formatItems,
  formatRupees,
  renderTemplate,
  templateProblems,
  type TemplateDefinition,
  type TemplateVars,
} from '../src/index';

// EP-07.US02.T01. Pure functions: no database, no network.

const FULL: TemplateVars = {
  storeName: 'Zara Lawn',
  customerName: 'Ayesha',
  orderNumber: 'ORD-ABCD2345',
  items: 'Lawn suit (Blue) x 2 - Rs. 7,000\nDupatta x 1 - Rs. 1,200',
  total: 'Rs. 8,450',
  paymentMethod: 'Cash on delivery',
  trackingLink: 'https://zara.markazify.com/track?order=ORD-ABCD2345',
  courier: 'TCS',
  trackingNumber: 'TCS-1001',
  city: 'Lahore',
  dashboardLink: 'https://seller.markazify.com/s/1/orders/2',
  productName: 'Lawn suit (Blue)',
  stockLeft: '3',
};

test('every template uses only variables it declares, and every declared variable is known', () => {
  assert.deepEqual(templateProblems(), []);
});

test('a template that uses an unknown or an undeclared variable is reported', () => {
  const broken: Record<string, TemplateDefinition> = {
    typo: { variables: ['storeName'], subject: '{{storName}}', en: ['{{storeName}}'], ur: [''], whatsapp: '' },
    undeclared: { variables: ['storeName'], subject: '{{storeName}}', en: ['{{orderNumber}}'], ur: [''], whatsapp: '' },
    declaresUnknown: { variables: ['storeName', 'shoeSize' as never], subject: '{{storeName}}', en: [''], ur: [''], whatsapp: '' },
  };
  const problems = templateProblems(broken);
  assert.ok(problems.some((p) => p.startsWith('typo: uses unknown variable storName')), problems.join('; '));
  assert.ok(problems.some((p) => p.startsWith('undeclared: uses undeclared variable orderNumber')), problems.join('; '));
  assert.ok(problems.some((p) => p.startsWith('declaresUnknown: declares unknown variable shoeSize')), problems.join('; '));
});

test('every named template exists and renders with English first and Urdu below', () => {
  assert.deepEqual(Object.keys(TEMPLATES).sort(), [...TEMPLATE_NAMES].sort());
  for (const name of TEMPLATE_NAMES) {
    const out = renderTemplate(name, FULL);
    assert.ok(out.subject.length > 0 && out.subject.length <= 200, name);
    assert.ok(out.text.includes('---'), name + ': the text has both parts');
    const urduAt = out.text.search(/[؀-ۿ]/);
    assert.ok(urduAt > out.text.indexOf('---'), name + ': Urdu comes after the English part');
    assert.ok(out.html.includes('dir="rtl" lang="ur"'), name + ': the Urdu block is right to left');
    assert.ok(out.whatsapp.length > 0, name);
    assert.equal(/\{\{/.test(out.text + out.html + out.subject + out.whatsapp), false, name + ': no placeholder is left');
  }
});

test('values are escaped in HTML and kept as they are in the text', () => {
  const out = renderTemplate('order_confirmed', { ...FULL, customerName: '<script>alert("x")</script> & Co' });
  assert.equal(out.html.includes('<script>'), false);
  assert.ok(out.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co'));
  assert.ok(out.text.includes('<script>alert("x")</script> & Co'));
});

test('a link becomes an anchor only when it is http(s); anything else is plain escaped text', () => {
  const good = renderTemplate('order_confirmed', FULL);
  assert.ok(good.html.includes('<a href="https://zara.markazify.com/track?order=ORD-ABCD2345">'));
  const bad = renderTemplate('order_confirmed', { ...FULL, trackingLink: 'javascript:alert(1)' });
  assert.equal(bad.html.includes('<a href="javascript'), false);
  assert.ok(bad.html.includes('javascript:alert(1)'));
});

test('the items block keeps its lines in HTML', () => {
  const out = renderTemplate('order_placed_customer', FULL);
  assert.ok(out.html.includes('Lawn suit (Blue) x 2 - Rs. 7,000<br>Dupatta x 1 - Rs. 1,200'));
});

test('a value cannot add a line to the subject', () => {
  const out = renderTemplate('order_confirmed', { ...FULL, storeName: 'Zara\r\nBcc: someone@example.com' });
  assert.equal(/[\r\n]/.test(out.subject), false);
});

test('a declared variable without a value is refused, so no message goes out with a hole', () => {
  const { courier: _courier, ...rest } = FULL;
  void _courier;
  assert.throws(() => renderTemplate('order_dispatched', rest), TemplateError);
  assert.throws(() => renderTemplate('order_dispatched', { ...FULL, trackingNumber: '   ' }), TemplateError);
  assert.throws(() => renderTemplate('no_such_template' as never, FULL), TemplateError);
});

test('escapeHtml, formatRupees and formatItems', () => {
  assert.equal(escapeHtml(`<a href='x'>&"`), '&lt;a href=&#39;x&#39;&gt;&amp;&quot;');
  assert.equal(formatRupees(2600), 'Rs. 2,600');
  assert.equal(formatRupees(1234.6), 'Rs. 1,235');
  assert.equal(formatItems([
    { title: 'Shirt', variantTitle: 'Default', quantity: 2, unitPrice: 1200 },
    { title: 'Cap', variantTitle: 'Red', quantity: 1, unitPrice: 900 },
  ]), 'Shirt x 2 - Rs. 2,400\nCap (Red) x 1 - Rs. 900');
});
