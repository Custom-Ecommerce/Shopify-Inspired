import mongoose from 'mongoose';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __markazAdminMongoose: MongooseCache | undefined;
}

// Cached on globalThis so hot reloads and repeated route invocations share one connection.
const cache: MongooseCache = globalThis.__markazAdminMongoose ?? { conn: null, promise: null };
globalThis.__markazAdminMongoose = cache;

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn) {
    return cache.conn;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.trim().length === 0) {
    throw new Error('MONGODB_URI is not set');
  }
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  }
  try {
    cache.conn = await cache.promise;
  } catch (err) {
    cache.promise = null;
    throw err;
  }
  return cache.conn;
}
