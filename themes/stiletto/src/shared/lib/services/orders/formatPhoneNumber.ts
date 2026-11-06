// ============================================================================
// formatPhoneNumber
// ----------------------------------------------------------------------------
// Converts a local Pakistani mobile number into E.164 standard (+92...)
// format. Extracted from packages/store/src/admin/createOrder.ts so the
// pure formatting logic can be reused/unit-tested outside the store admin
// client.
// ============================================================================

export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, "");

  // Convert local 03xx to +923xx
  if (cleaned.startsWith("03")) {
    return `+92${cleaned.slice(1)}`;
  }

  // Convert 923xx to +923xx
  if (cleaned.startsWith("92")) {
    return `+${cleaned}`;
  }

  // Default fallback if already formatted or other structure
  return phone.startsWith("+") ? phone : `+${cleaned}`;
}
