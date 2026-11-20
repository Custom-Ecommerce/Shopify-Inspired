import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerToSellerWhatsappLink, sellerToCustomerWhatsappLink, whatsappDigits, whatsappLink } from '../src/whatsapp';

// EP-07.US01.T05: wa.me links. The number rule is the shared one from @markaz/contracts.

const ORDER = {
  status: 'confirmed',
  orderNumber: 'ORD-ABCD2345',
  customerName: 'Ayesha',
  phone: '+923001234567',
  customerWhatsapp: null,
  courier: null,
  trackingNumber: null,
  trackingLink: 'https://zara.markazify.com/track?order=ORD-ABCD2345',
};

test('Pakistani numbers in any common form become the same wa.me number', () => {
  for (const input of ['03001234567', '0300 1234567', '+92 300 1234567', '923001234567', '00923001234567']) {
    assert.equal(whatsappDigits(input), '923001234567', input);
  }
  assert.equal(whatsappDigits('12345'), null);
  assert.equal(whatsappDigits(undefined), null);
});

test('the link carries the text encoded, and no link exists for a bad number', () => {
  const link = whatsappLink('03001234567', 'Hi & bye\nآپ');
  assert.ok(link?.startsWith('https://wa.me/923001234567?text='));
  assert.equal(decodeURIComponent(link!.split('?text=')[1]!), 'Hi & bye\nآپ');
  assert.equal(whatsappLink('nope', 'x'), null);
});

test('the seller link exists for confirmed, dispatched with tracking, and delivered orders only', () => {
  assert.ok(sellerToCustomerWhatsappLink(ORDER, 'Zara Lawn')?.includes('wa.me/923001234567'));
  assert.ok(sellerToCustomerWhatsappLink({ ...ORDER, status: 'delivered' }, 'Zara Lawn'));
  assert.equal(sellerToCustomerWhatsappLink({ ...ORDER, status: 'dispatched' }, 'Zara Lawn'), null, 'no tracking number yet');
  const dispatched = sellerToCustomerWhatsappLink({ ...ORDER, status: 'dispatched', courier: 'TCS', trackingNumber: 'TCS-1001' }, 'Zara Lawn');
  assert.ok(decodeURIComponent(dispatched!).includes('TCS-1001'));
  for (const status of ['pending', 'processing', 'cancelled', 'returned']) {
    assert.equal(sellerToCustomerWhatsappLink({ ...ORDER, status }, 'Zara Lawn'), null, status);
  }
});

test("the customer's WhatsApp number wins over the phone", () => {
  const link = sellerToCustomerWhatsappLink({ ...ORDER, customerWhatsapp: '03211234567' }, 'Zara Lawn');
  assert.ok(link?.startsWith('https://wa.me/923211234567'));
});

test('the shopper link needs the store number', () => {
  assert.equal(customerToSellerWhatsappLink(null, 'Zara Lawn', 'ORD-ABCD2345'), null);
  assert.equal(customerToSellerWhatsappLink('', 'Zara Lawn', 'ORD-ABCD2345'), null);
  const link = customerToSellerWhatsappLink('0300-1234567', 'Zara Lawn', 'ORD-ABCD2345');
  assert.ok(link?.startsWith('https://wa.me/923001234567?text='));
  assert.ok(decodeURIComponent(link!).includes('ORD-ABCD2345'));
});
