
import { POLICY_MATRIX } from './policy';
import type { Actor, FieldAllowlist, FieldPolicy, Operation } from './policy';

/** Thrown when the matrix is misconfigured or a collection is undeclared. Fail closed. */
export class PolicyConfigError extends Error {
constructor(message: string) {
super(message);
this.name = 'PolicyConfigError';
}
}

/** Thrown by assertCan() when an access check is denied. */
export class PolicyDeniedError extends Error {
constructor(message: string) {
super(message);
this.name = 'PolicyDeniedError';
}
}

function resolveAllowlist(policy: FieldPolicy, actor: Actor): FieldAllowlist | undefined {
if (policy === '*') return '*';
if (Array.isArray(policy)) return policy as readonly string[];
return (policy as Partial<Record<Actor, FieldAllowlist>>)[actor];
}

/**
* A requested field is allowed when it equals an allowlist entry or sits under one
* on a dot boundary: 'storefront.heroBanners' is allowed by 'storefront', but
* 'storefrontEvil' is not.
*/
function isFieldAllowed(field: string, allowed: readonly string[]): boolean {
if (field.trim() === '') return false;
return allowed.some((entry) => field === entry || field.startsWith(entry + '.'));
}

/**
* Returns true only when the actor may perform the operation on the listed fields.
*
* Fail-closed rules:
* - an undeclared collection throws PolicyConfigError (a programming error, not a denial)
* - an actor not listed for the operation is denied
* - a field-restricted rule with no field list is denied (this was the audit's fail-open bug)
* - every requested field must be allowed; any miss denies the whole request
*/
export function can(
actor: Actor,
operation: Operation,
collection: string,
requestedFields?: readonly string[],
): boolean {
const collectionPolicy = POLICY_MATRIX[collection];
if (!collectionPolicy) {
throw new PolicyConfigError("Collection '" + collection + "' is not declared in POLICY_MATRIX.");
}
const rule = collectionPolicy[operation];
if (!rule.actors.includes(actor)) return false;

const allowed = resolveAllowlist(rule.fields, actor);
if (allowed === undefined) return false;
if (allowed === '*') return true;

if (!requestedFields || requestedFields.length === 0) return false;
return requestedFields.every((field) => isFieldAllowed(field, allowed));
}

/** Same check as can(), but throws PolicyDeniedError for use in route handlers. */
export function assertCan(
actor: Actor,
operation: Operation,
collection: string,
requestedFields?: readonly string[],
): void {
if (!can(actor, operation, collection, requestedFields)) {
throw new PolicyDeniedError(
"Actor '" + actor + "' may not " + operation + " " + collection +
(requestedFields && requestedFields.length ? " [" + requestedFields.join(', ') + "]" : ''),
);
}
}
