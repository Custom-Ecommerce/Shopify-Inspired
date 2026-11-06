export function requireRole(userRole: string, allowedRoles: string[]): boolean {
  if (!allowedRoles.includes(userRole)) {
    throw new Error(`Access denied: User role '${userRole}' is not authorized. Requires one of: ${allowedRoles.join(', ')}`);
  }
  return true;
}
