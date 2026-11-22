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
  contactName: 'Sara Khan',
  contactEmail: 'sara@example.com',
  contactPhone: '0300 1234567',
  contactMessage: 'Do you deliver to Quetta?\nPlease tell me the charge.',
  replyText: 'Yes, we deliver to Quetta for Rs. 300.',
  ticketSubject: 'My payout is late',
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
  appName: 'Markazify',
  actionLink: 'https://seller.markazify.com/reset-password?token=abc',
  validFor: '30 minutes',
  newEmail: 'new@example.com',
  storefrontLink: 'https://zara.markazify.com',
  payoutAmount: 'Rs. 12,500',
  payoutMethod: 'JazzCash',
  payoutReference: 'JC-778812',
  voidReason: 'Sent to the wrong account',
  broadcastSubject: 'Eid sale',
  broadcastMessage: 'Everything is 20% off this weekend.',
  unsubscribeLink: 'https://seller.markazify.com/unsubscribe?s=1&e=a&t=b',
  emailFooter: 'Zara Lawn, Lahore',
  // Sprint 5 EP-13: the return templates.
  returnNumber: 'RET-7KQ4M2XA',
  returnReason: 'The item was used',
  // Sprint 5 EP-21: the new review's rating and text.
  reviewRating: '5 out of 5',
  reviewText: 'Soft fabric, true to size.\nWill order again.',
  // Sprint 6 EP-12.US02: the operator's reason.
  suspensionReason: 'Reported for selling fake products',
  // Sprint 6 EP-14 (S6-B4): the subscription payment templates.
  planName: 'Growth',
  paymentAmount: 'Rs. 2,500',
  paymentReference: 'TX-77812',
  periodEnd: '20 December 2026',
  paymentReason: 'The amount did not match',
  sellerEmail: 'ayesha@example.com',
  // Sprint 8 (S8-B2): the team templates.
  memberRole: 'Manager',
  memberName: 'sara@example.com',
  invitedBy: 'Ayesha Khan',
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

test('Sprint 4 account emails: the link is an anchor, values are escaped, and Urdu follows English', () => {
  for (const name of ['password_reset', 'password_changed', 'email_verify', 'email_change_verify'] as const) {
    const out = renderTemplate(name, { ...FULL, customerName: '<img src=x onerror=alert(1)>' });
    assert.ok(out.html.includes('<a href="https://seller.markazify.com/reset-password?token=abc">'), name);
    assert.equal(out.html.includes('<img'), false, name + ': the name is escaped');
    assert.ok(out.text.indexOf('---') < out.text.search(/[؀-ۿ]/), name);
  }
  const change = renderTemplate('email_change_verify', FULL);
  assert.ok(change.text.includes('new@example.com'));
  assert.throws(() => renderTemplate('password_reset', { ...FULL, actionLink: '' }), TemplateError);
});

test('store_live renders English and Urdu with the store name and both links', () => {
  const rendered = renderTemplate('store_live', FULL);
  assert.match(rendered.subject, /Zara Lawn is live/);
  assert.ok(rendered.text.includes('https://zara.markazify.com'));
  assert.ok(rendered.text.includes('https://seller.markazify.com/s/1/orders/2'));
  assert.match(rendered.text, /[؀-ۿ]/);
});

test('payout_paid says how much, how and under which reference, in English then Urdu', () => {
  const out = renderTemplate('payout_paid', FULL);
  assert.match(out.subject, /Zara Lawn: we sent you Rs\. 12,500/);
  for (const part of ['Rs. 12,500', 'JazzCash', 'JC-778812', 'https://seller.markazify.com/s/1/orders/2']) assert.ok(out.text.includes(part), part);
  assert.ok(out.text.indexOf('---') < out.text.search(/[؀-ۿ]/));
  assert.ok(out.html.includes('<a href="https://seller.markazify.com/s/1/orders/2">'));
  assert.ok(out.whatsapp.includes('JC-778812'));
  assert.throws(() => renderTemplate('payout_paid', { ...FULL, payoutReference: ' ' }), TemplateError);
});

test('payout_voided gives the reason, escaped in HTML and as it is in the text', () => {
  const out = renderTemplate('payout_voided', { ...FULL, voidReason: 'Wrong <b>account</b> & amount' });
  assert.ok(out.text.includes('Wrong <b>account</b> & amount'));
  assert.equal(out.html.includes('<b>account</b>'), false);
  assert.ok(out.html.includes('Wrong &lt;b&gt;account&lt;/b&gt; &amp; amount'));
  assert.match(out.subject, /a payout of Rs\. 12,500 was cancelled/);
  assert.match(out.text, /[؀-ۿ]/);
  assert.throws(() => renderTemplate('payout_voided', { ...FULL, voidReason: '' }), TemplateError);
});

// ---------------------------------------------------------------------------------------------------------------- Sprint 5 EP-21, EP-28

test('review_received_seller: the reviewer, the product and the text are escaped in HTML, the text keeps its lines, and the link is an anchor', () => {
  const out = renderTemplate('review_received_seller', {
    ...FULL,
    customerName: '<b>Ayesha</b>',
    productName: 'Lawn <i>suit</i>',
    reviewText: '<script>alert(1)</script> Nice & soft\nSecond line',
  });
  assert.equal(out.html.includes('<script>'), false);
  assert.equal(out.html.includes('<b>Ayesha'), false);
  assert.ok(out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; Nice &amp; soft<br>Second line'));
  assert.ok(out.html.includes('<a href="https://seller.markazify.com/s/1/orders/2">'));
  assert.ok(out.text.includes('<script>alert(1)</script> Nice & soft'), 'the plain text keeps the value as it is');
  assert.match(out.subject, /^New review for /);
  assert.equal(/[\r\n]/.test(out.subject), false);
  assert.ok(out.text.indexOf('---') < out.text.search(/[؀-ۿ]/), 'Urdu follows English');
});

test('abandoned_cart: bilingual, the items keep their lines, the unsubscribe and store links are anchors, every value is escaped', () => {
  const out = renderTemplate('abandoned_cart', {
    ...FULL,
    storeName: 'Zara <Lawn>',
    items: 'Lawn suit (Blue) x 2 - Rs. 7,000\n<img src=x onerror=alert(1)> x 1 - Rs. 100',
    total: 'Rs. 7,100',
  });
  assert.equal(out.html.includes('<img'), false, 'an item name is escaped');
  assert.equal(out.html.includes('Zara <Lawn>'), false, 'the store name is escaped');
  assert.ok(out.html.includes('Lawn suit (Blue) x 2 - Rs. 7,000<br>'));
  assert.ok(out.html.includes('<a href="https://zara.markazify.com">'));
  assert.ok(out.html.includes('<a href="https://seller.markazify.com/unsubscribe?s=1&amp;e=a&amp;t=b">'));
  assert.ok(out.text.includes('To stop these emails: https://seller.markazify.com/unsubscribe?s=1&e=a&t=b'));
  assert.ok(out.text.indexOf('---') < out.text.search(/[؀-ۿ]/), 'Urdu follows English');
  assert.match(out.subject, /you left something in your cart/);
  // No hole: a missing unsubscribe link refuses the message, so one can never go out without it.
  assert.throws(() => renderTemplate('abandoned_cart', { ...FULL, unsubscribeLink: '' }), TemplateError);
});

// Sprint 6 EP-12.US02.T03 (CO-82): the store paused, account suspended and account reactivated emails.

test('Sprint 6: the paused, suspended and reactivated emails exist, are bilingual and render without a hole', () => {
  for (const name of ['store_paused', 'account_suspended', 'account_reactivated'] as const) {
    assert.ok((TEMPLATE_NAMES as readonly string[]).includes(name), name);
    const out = renderTemplate(name, FULL);
    assert.ok(out.subject.length > 0, name);
    assert.ok(out.html.includes('dir="rtl" lang="ur"'), name);
    assert.ok(out.text.search(/[؀-ۿ]/) > out.text.indexOf('---'), name);
    assert.equal(/\{\{/.test(out.text + out.html + out.subject + out.whatsapp), false, name);
  }
  assert.equal(renderTemplate('store_paused', FULL).subject, 'Zara Lawn was paused');
  assert.equal(renderTemplate('account_suspended', FULL).subject, 'Markazify: your account was suspended');
  assert.equal(renderTemplate('account_reactivated', FULL).subject, 'Markazify: your account is active again');
});

test('Sprint 6: the operator reason is shown in the suspended and paused emails and escaped in HTML', () => {
  for (const name of ['store_paused', 'account_suspended'] as const) {
    const out = renderTemplate(name, { ...FULL, suspensionReason: '<script>alert(1)</script> fake goods' });
    assert.ok(out.text.includes('Reason: <script>alert(1)</script> fake goods'), name);
    assert.equal(out.html.includes('<script>'), false, name);
    assert.ok(out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; fake goods'), name);
  }
});

test('Sprint 6: a reason cannot add a line to the subject, and a missing reason is refused', () => {
  assert.equal(/[\r\n]/.test(renderTemplate('store_paused', { ...FULL, storeName: 'Zara\r\nBcc: x@example.com' }).subject), false);
  const { suspensionReason: _reason, ...rest } = FULL;
  void _reason;
  assert.throws(() => renderTemplate('account_suspended', rest), TemplateError);
  assert.throws(() => renderTemplate('store_paused', { ...FULL, suspensionReason: '  ' }), TemplateError);
  // reactivating needs no reason
  assert.doesNotThrow(() => renderTemplate('account_reactivated', rest));
});

test('Sprint 6: the reactivated email does not mention a reason and the suspended one does not promise the storefront is down', () => {
  assert.equal(renderTemplate('account_reactivated', FULL).text.includes('Reason'), false);
  assert.ok(renderTemplate('account_suspended', FULL).text.includes('storefront stays online'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Sprint 6 EP-14 (S6-B4, D-118): the subscription payment templates.

const PAYMENT_TEMPLATES = ['payment_claimed', 'payment_confirmed', 'payment_rejected', 'subscription_expiring', 'subscription_expired'] as const;

test('the five subscription templates exist, declare their variables and render in both languages', () => {
  for (const name of PAYMENT_TEMPLATES) {
    assert.ok(TEMPLATE_NAMES.includes(name), name);
    const out = renderTemplate(name, FULL);
    assert.ok(out.subject.includes('Growth'), name + ': the plan is in the subject');
    assert.ok(out.text.search(/[؀-ۿ]/) > out.text.indexOf('---'), name + ': Urdu below the English');
  }
  assert.deepEqual(templateProblems(), []);
});

test('payment claimed carries the seller, the plan, the amount, the method and the reference', () => {
  const out = renderTemplate('payment_claimed', FULL);
  for (const part of ['Ayesha', 'ayesha@example.com', 'Growth', 'Rs. 2,500', 'Cash on delivery', 'TX-77812']) assert.ok(out.text.includes(part), part);
  assert.equal(out.text.includes('{{'), false);
});

test('payment confirmed names the end of the period; rejected names the reason; expiring names the date; expired says nothing was deleted', () => {
  assert.ok(renderTemplate('payment_confirmed', FULL).text.includes('20 December 2026'));
  assert.ok(renderTemplate('payment_confirmed', FULL).subject.includes('Rs. 2,500'));
  assert.ok(renderTemplate('payment_rejected', FULL).text.includes('The amount did not match'));
  assert.ok(renderTemplate('subscription_expiring', FULL).subject.includes('20 December 2026'));
  assert.match(renderTemplate('subscription_expired', FULL).text, /Nothing was deleted/);
});

test('the typed reference and the seller name are escaped in HTML', () => {
  const out = renderTemplate('payment_claimed', { ...FULL, paymentReference: '<img src=x onerror=alert(1)>', customerName: 'A & B <b>' });
  assert.equal(out.html.includes('<img'), false);
  assert.equal(out.html.includes('<b>'), false);
  assert.ok(out.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.html.includes('A &amp; B &lt;b&gt;'));
});

test('a subscription email refuses to render with a variable missing', () => {
  for (const name of PAYMENT_TEMPLATES) {
    const vars = { ...FULL } as Record<string, string | undefined>;
    for (const variable of TEMPLATES[name].variables) {
      const broken = { ...vars, [variable]: '' };
      assert.throws(() => renderTemplate(name, broken as TemplateVars), TemplateError, name + ' without ' + variable);
    }
  }
});

test('Sprint 7 (S7-B4): the four support templates exist, keep a message on separate lines, and escape what a sender typed', () => {
  for (const name of ['contact_message_store', 'contact_message_platform', 'contact_reply', 'ticket_admin_reply'] as const) assert.ok((TEMPLATE_NAMES as readonly string[]).includes(name), name);
  const out = renderTemplate('contact_message_store', { ...FULL, contactMessage: '<img src=x onerror=alert(1)>\nsecond line' });
  assert.equal(out.html.includes('<img'), false);
  assert.ok(out.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(out.text.includes('second line'));
  const reply = renderTemplate('contact_reply', { ...FULL, replyText: '<b>hi</b>' });
  assert.equal(reply.html.includes('<b>hi</b>'), false);
  assert.equal(renderTemplate('ticket_admin_reply', FULL).subject, 'Markazify support answered: My payout is late');
  assert.deepEqual(templateProblems(), []);
});

test('Sprint 8 (S8-B1): the order placed emails show the tax line only when it has a value; an order without tax reads exactly as before', () => {
  for (const name of ['order_placed_customer', 'order_placed_seller'] as const) {
    assert.deepEqual(TEMPLATES[name].optionalVariables, ['taxLine'], name);
    assert.equal(TEMPLATES[name].variables.includes('taxLine' as never), false, 'optional, so it is never required');
    const without = renderTemplate(name, FULL);
    const empty = renderTemplate(name, { ...FULL, taxLine: '' });
    const blank = renderTemplate(name, { ...FULL, taxLine: '   ' });
    assert.deepEqual(empty, without);
    assert.deepEqual(blank, without);
    assert.equal(without.text.includes('{{'), false, 'no placeholder is left in the text');
    assert.equal(without.html.includes('<p style="margin:0 0 12px"></p>'), false, 'no empty paragraph is left in the HTML');
    assert.ok(without.text.includes('Total: Rs. 8,450') || without.text.includes('Total: ' + FULL.total), name);

    const taxed = renderTemplate(name, { ...FULL, taxLine: 'Tax (included): Rs. 170' });
    assert.ok(taxed.text.includes('Tax (included): Rs. 170'), name);
    assert.ok(taxed.html.includes('Tax (included): Rs. 170'), name);
    assert.ok(taxed.text.indexOf('Tax (included): Rs. 170') < taxed.text.indexOf('Total: '), 'the tax line is above the total');
    // The Urdu half carries the line too.
    assert.ok(taxed.text.split('---')[1]!.includes('Tax (included): Rs. 170'), name);
  }
  assert.deepEqual(templateProblems(), []);
});

test('Sprint 8 (S8-B1): the tax line is escaped in HTML and cannot add lines; the other templates do not take it', () => {
  const out = renderTemplate('order_placed_customer', { ...FULL, taxLine: '<b>GST</b>: Rs. 5\nBcc: x@y.z' });
  assert.equal(out.html.includes('<b>GST</b>'), false);
  assert.ok(out.html.includes('&lt;b&gt;GST&lt;/b&gt;'));
  assert.equal(out.text.includes('\nBcc: x@y.z'), false, 'a control character in the value becomes a space');
  for (const name of TEMPLATE_NAMES) {
    if (name === 'order_placed_customer' || name === 'order_placed_seller') continue;
    assert.equal(TEMPLATES[name].optionalVariables, undefined, name);
  }
  const plain = renderTemplate('order_confirmed', { ...FULL, taxLine: 'Tax: Rs. 1' });
  assert.equal(plain.text.includes('Tax: Rs. 1'), false, 'a template that does not use the variable ignores it');
});

test('Sprint 8 (S8-B2): the three team templates exist, carry the store, the role and the link, and are valid', () => {
  for (const name of ['staff_invite', 'staff_invite_accepted', 'staff_access_removed'] as const) assert.ok((TEMPLATE_NAMES as readonly string[]).includes(name), name);
  const invite = renderTemplate('staff_invite', { ...FULL, storeName: 'Zara Lawn', invitedBy: 'Ayesha Khan', memberRole: 'Support', actionLink: 'https://seller.markazify.com/accept-invite?token=abc', validFor: '7 days' });
  assert.equal(invite.subject, 'Ayesha Khan invited you to Zara Lawn on Markazify');
  assert.ok(invite.text.includes('as Support'));
  assert.ok(invite.text.includes('https://seller.markazify.com/accept-invite?token=abc'));
  assert.ok(invite.text.includes('7 days'));
  assert.ok(invite.html.includes('<a href="https://seller.markazify.com/accept-invite?token=abc">'), 'the link is a link');
  const accepted = renderTemplate('staff_invite_accepted', { ...FULL, memberName: 'sara@example.com', memberRole: 'Staff', storeName: 'Zara Lawn', dashboardLink: 'https://seller.markazify.com/s/1/team' });
  assert.equal(accepted.subject, 'sara@example.com joined Zara Lawn');
  assert.ok(accepted.text.includes('as Staff'));
  assert.ok(accepted.html.includes('https://seller.markazify.com/s/1/team'));
  const removed = renderTemplate('staff_access_removed', { ...FULL, memberName: 'Sara', storeName: 'Zara Lawn' });
  assert.equal(removed.subject, 'Your access to Zara Lawn was removed');
  assert.ok(removed.text.includes('Hi Sara'));
  assert.deepEqual(templateProblems(), []);
});

test('Sprint 8 (S8-B2): what a person typed is escaped in the team emails and cannot add lines to a subject', () => {
  const invite = renderTemplate('staff_invite', { ...FULL, storeName: '<script>alert(1)</script> Shop', invitedBy: '<b>Ayesha</b>\nBcc: x@y.z', memberRole: 'Manager' });
  assert.equal(invite.html.includes('<script>'), false);
  assert.equal(invite.html.includes('<b>Ayesha</b>'), false);
  assert.ok(invite.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; Shop'));
  assert.equal(/[\r\n]/.test(invite.subject), false, 'a control character in a name never reaches the subject');
  const accepted = renderTemplate('staff_invite_accepted', { ...FULL, memberName: '"><img src=x>' });
  assert.equal(accepted.html.includes('<img'), false);
  const removed = renderTemplate('staff_access_removed', { ...FULL, memberName: '<i>x</i>' });
  assert.equal(removed.html.includes('<i>'), false);
});

test('Sprint 8 (S8-B2): every team template needs its values (a missing one is an error, never a half-empty email)', () => {
  const { storeName: _s, ...withoutStore } = FULL;
  void _s;
  for (const name of ['staff_invite', 'staff_invite_accepted', 'staff_access_removed'] as const) {
    assert.throws(() => renderTemplate(name, withoutStore), TemplateError, name);
  }
  const { actionLink: _a, ...withoutLink } = FULL;
  void _a;
  assert.throws(() => renderTemplate('staff_invite', withoutLink), TemplateError);
});
