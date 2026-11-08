import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { STORE_SLUG_MAX_LENGTH, STORE_SLUG_MIN_LENGTH } from '@markaz/platform-kit/reservation';
import { authenticate } from '@/lib/auth';
import { seedStoreDemoData } from '@/lib/demo-data';
import { HttpError, handleRouteError, isDuplicateKeyError, parseIntParam } from '@/lib/http';
import { connectSellerDb } from '@/lib/mongo';
import { SELLER_STORE_READABLE_FIELDS, Store, assertCan } from '@/lib/services';
import { newStoreStorefront } from '@/lib/store-defaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORES_COLLECTION = 'stores';
const MAX_BODY_BYTES = 16 * 1024;

const createStoreSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .min(STORE_SLUG_MIN_LENGTH)
      .max(STORE_SLUG_MAX_LENGTH)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug may only contain lowercase letters, digits and single hyphens'),
    owner: z.string().optional(),
  })
  .strict();

/**
 * GET /api/stores
 *
 * Sellers receive only the stores they own, projected to the fields the policy matrix
 * lets a seller read (no commission, billing or revision counters). Admin callers
 * receive the full document set, as the matrix allows.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    const projection = ctx.actor === 'seller' ? [...SELLER_STORE_READABLE_FIELDS] : undefined;
    assertCan(ctx.actor, 'read', STORES_COLLECTION, projection);

    const params = request.nextUrl.searchParams;
    const limit = parseIntParam(params.get('limit'), 20, 1, 100);
    const page = parseIntParam(params.get('page'), 1, 1, 100000);

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    const filter = ctx.actor === 'seller' ? { owner: ctx.userObjectId } : {};

    const query = Store.find(filter);
    if (projection) query.select(projection.join(' '));

    const [docs, totalDocs] = await Promise.all([
      query
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Store.countDocuments(filter),
    ]);

    return NextResponse.json(
      {
        docs: docs.map((doc) => {
          const { _id, __v, ...rest } = doc as typeof doc & { __v?: number };
          void __v;
          return { id: String(_id), ...rest };
        }),
        totalDocs,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalDocs / limit)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * POST /api/stores
 *
 * Policy is enforced first, before the body is read. With the shipped matrix only admin
 * and system may create stores; a seller receives 403. New stores start as 'pending'.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);

    assertCan(ctx.actor, 'create', STORES_COLLECTION);

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, 'Body is not valid JSON');
    }

    const parsed = createStoreSchema.safeParse(json);
    if (!parsed.success) {
      throw new HttpError(400, 'Invalid store: ' + (parsed.error.issues[0]?.message ?? 'unknown error'));
    }
    const input = parsed.data;

    // A seller can only ever own what they create; an admin must name the owner.
    let ownerId: mongoose.Types.ObjectId;
    if (ctx.actor === 'seller') {
      if (input.owner !== undefined && input.owner !== ctx.userId) {
        throw new HttpError(403, 'You do not have permission to perform this action');
      }
      ownerId = ctx.userObjectId;
    } else {
      if (input.owner === undefined || !mongoose.isValidObjectId(input.owner)) {
        throw new HttpError(400, 'owner must be a valid user id');
      }
      ownerId = new mongoose.Types.ObjectId(input.owner);
    }

    await connectSellerDb().catch(() => {
      throw new HttpError(503, 'Seller database unavailable');
    });

    let created;
    try {
      created = await Store.create({
        name: input.name,
        slug: input.slug,
        owner: ownerId,
        status: 'pending',
        storefront: newStoreStorefront(),
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new HttpError(409, 'A store with this slug already exists');
      throw err;
    }

    await seedStoreDemoData(String(created._id));

    return NextResponse.json(
      {
        doc: {
          id: String(created._id),
          name: created.name,
          slug: created.slug,
          status: created.status,
          createdAt: created.createdAt,
        },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
