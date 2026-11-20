import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, renderTemplate, templateProblems, type TemplateDefinition, type TemplateVars } from '../src/templates';
import { renderMessageOverride, sellerToCustomerWhatsappLink, whatsappPreviewText } from '../src/whatsapp';

// Sprint 4 EP-07.US04 (the 'broadcast' template) and EP-07.US02.T02 (the seller's own WhatsApp text and email footer).

const VARS: TemplateVars = {
  storeName: 'Zara <Lawn> & Co',
  broadcastSubject: 'Eid "sale"',
  broadcastMessage: 'Line one <b>bold</b>\nLine two & more',
  emailFooter: 'Model Town, Lahore <script>x</script>',
  unsubscribeLink: 'https://seller.markazify.com/unsubscribe?s=1&e=a%40b.com&t=abc',
};

test('the broadcast template declares exactly the variables it uses, and an unknown variable still fails the template check', () => {
  assert.deepEqual(templateProblems(), []);
  assert.deepEqual([...TEMPLATES.broadcast.variables].sort(), ['broadcastMessage', 'broadcastSubject', 'emailFooter', 'storeName', 'unsubscribeLink']);
  const broken: Record<string, TemplateDefinition> = {
    broadcast: { ...TEMPLATES.broadcast, en: [...TEMPLATES.broadcast.en, '{{customerEmail}}'] },
  };
  assert.ok(templateProblems(broken).some((problem) => problem.startsWith('broadcast: uses unknown variable customerEmail')));
});

test('the seller text, the store name and the footer are escaped in HTML and kept as written in the text', () => {
  const out = renderTemplate('broadcast', VARS);
  assert.equal(out.html.includes('<b>bold</b>'), false);
  assert.equal(out.html.includes('<script>'), false);
  assert.ok(out.html.includes('Line one &lt;b&gt;bold&lt;/b&gt;<br>Line two &amp; more'));
  assert.ok(out.html.includes('Zara &lt;Lawn&gt; &amp; Co'));
  assert.ok(out.html.includes('Model Town, Lahore &lt;script&gt;x&lt;/script&gt;'));
  assert.ok(out.text.includes('Line one <b>bold</b>\nLine two & more'));
  assert.equal(out.subject, 'Eid "sale"');
});

test('the unsubscribe link is a real link in HTML (escaped) and plain in the text, in the English and the Urdu part', () => {
  const out = renderTemplate('broadcast', VARS);
  assert.ok(out.html.includes('<a href="https://seller.markazify.com/unsubscribe?s=1&amp;e=a%40b.com&amp;t=abc">'));
  assert.ok(out.text.includes('https://seller.markazify.com/unsubscribe?s=1&e=a%40b.com&t=abc'));
  assert.ok(out.text.indexOf('ایسی ای میلز') > out.text.indexOf('---'));
});

test('a subject cannot add a line to the email', () => {
  const out = renderTemplate('broadcast', { ...VARS, broadcastSubject: 'Hi\r\nBcc: spy@example.com' });
  assert.equal(/[\r\n]/.test(out.subject), false);
});

test('a broadcast without its unsubscribe link is refused, so none goes out without one', () => {
  const { unsubscribeLink: _link, ...rest } = VARS;
  void _link;
  assert.throws(() => renderTemplate('broadcast', rest), /missing value for unsubscribeLink/);
});

test('the store footer option is added at the end of an order email, escaped, with its line breaks', () => {
  const vars: TemplateVars = { storeName: 'Zara', customerName: 'Ayesha', orderNumber: 'ORD-1', trackingLink: 'https://zara.markazify.com/track?order=ORD-1' };
  const plain = renderTemplate('order_confirmed', vars);
  const withFooter = renderTemplate('order_confirmed', vars, { footer: 'Call us <now>\nThank you' });
  assert.ok(withFooter.text.endsWith('\n\n---\nCall us <now>\nThank you'));
  assert.ok(withFooter.html.includes('Call us &lt;now&gt;<br>Thank you'));
  assert.equal(withFooter.html.includes('<now>'), false);
  assert.ok(withFooter.html.endsWith('</div></body></html>'));
  assert.equal(plain.text.includes('Thank you'), false);
  assert.equal(renderTemplate('order_confirmed', vars, { footer: '   ' }).text, plain.text);
  assert.equal(renderTemplate('order_confirmed', vars, { footer: null }).html, plain.html);
});

// ------------------------------------------------------------------------------------------------ the WhatsApp text

const VALUES = { storeName: 'Zara Lawn', customerName: 'Ayesha', orderNumber: 'ORD-1', courier: 'TCS', trackingNumber: 'T-9', trackingLink: 'https://zara.markazify.com/track?order=ORD-1' };

test('the seller WhatsApp text has its {names} filled in; a name that is not a variable is left as written', () => {
  assert.equal(renderMessageOverride('Hi {customerName}, {orderNumber} from { storeName }.', VALUES), 'Hi Ayesha, ORD-1 from Zara Lawn.');
  assert.equal(renderMessageOverride('Hi {nobody} {customerName}', VALUES), 'Hi {nobody} Ayesha');
  assert.equal(renderMessageOverride('{courier}: {trackingNumber}', { courier: 'TCS' }), 'TCS: ');
});

test('the order page link uses the seller text for every status it applies to, and the platform text without one', () => {
  const order = { status: 'confirmed', orderNumber: 'ORD-1', customerName: 'Ayesha', phone: '+923001234567', customerWhatsapp: null, courier: null, trackingNumber: null, trackingLink: VALUES.trackingLink };
  const custom = sellerToCustomerWhatsappLink(order, 'Zara Lawn', 'Salam {customerName}! {storeName} order {orderNumber}');
  assert.ok(custom);
  assert.equal(decodeURIComponent(custom.split('?text=')[1]!), 'Salam Ayesha! Zara Lawn order ORD-1');
  const platform = sellerToCustomerWhatsappLink(order, 'Zara Lawn', null);
  assert.ok(platform);
  assert.ok(decodeURIComponent(platform.split('?text=')[1]!).includes('is confirmed'));
  assert.equal(sellerToCustomerWhatsappLink(order, 'Zara Lawn', '   '), platform, 'an empty text means the platform text');

  const dispatched = { ...order, status: 'dispatched', courier: 'TCS', trackingNumber: 'T-9' };
  assert.equal(decodeURIComponent(sellerToCustomerWhatsappLink(dispatched, 'Zara Lawn', '{courier} {trackingNumber}')!.split('?text=')[1]!), 'TCS T-9');
});

test('the override does not change when a link applies: no link for a pending order or a dispatch without tracking', () => {
  const order = { status: 'pending', orderNumber: 'ORD-1', customerName: 'Ayesha', phone: '+923001234567', customerWhatsapp: null, courier: null, trackingNumber: null };
  assert.equal(sellerToCustomerWhatsappLink(order, 'Zara', 'Hello'), null);
  assert.equal(sellerToCustomerWhatsappLink({ ...order, status: 'dispatched' }, 'Zara', 'Hello'), null);
});

test('the settings preview shows the seller text with sample values, or the platform text when there is none', () => {
  assert.equal(whatsappPreviewText('Hi {customerName}, {storeName}', 'Zara Lawn'), 'Hi Ayesha, Zara Lawn');
  assert.ok(whatsappPreviewText(null, 'Zara Lawn').includes('Zara Lawn'));
  assert.equal(whatsappPreviewText('  ', 'Zara Lawn'), whatsappPreviewText(null, 'Zara Lawn'));
});
