import mongoose from 'mongoose';

interface MongoCache {
promise: Promise<typeof mongoose> | null;
}

const globalWithCache = globalThis as typeof globalThis & { __sellerMongo?: MongoCache };
const cache: MongoCache = globalWithCache.__sellerMongo ?? { promise: null };
globalWithCache.__sellerMongo = cache;

/** Connect once per process (reused across hot reloads and warm invocations). */
export async function connectSellerDb(): Promise<typeof mongoose> {
const uri = process.env.SELLER_MONGODB_URI;
if (!uri) {
throw new Error('SELLER_MONGODB_URI is not set');
}
if (!cache.promise) {
cache.promise = mongoose.connect(uri, { bufferCommands: false }).catch((err: unknown) => {
cache.promise = null;
throw err;
});
}
return cache.promise;
}
