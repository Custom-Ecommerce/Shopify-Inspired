import Link from 'next/link';
import type { Metadata } from 'next';
import React from 'react';

// Neither page is about a real catalogue, so neither is indexed (D-078 keeps inactive stores noindex).
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Shown for a store that is not serving. Sprint 4 EP-04.US06 (D-094): a store that has not gone live yet (pending) gets a
 * plain "opening soon" answer with no products; a suspended or archived store keeps the old text.
 */
export default async function StoreUnavailablePage({ searchParams }: { searchParams: Promise<{ state?: string | string[] }> }) {
  const { state } = await searchParams;
  const opening = state === 'opening';
  return (
    <div className="flex flex-col items-center justify-center flex-grow p-4 text-center">
      <h1 className="text-4xl font-bold mb-4">{opening ? 'Opening soon' : 'Store Unavailable'}</h1>
      <p className="text-gray-600 mb-8">{opening ? 'This store is getting ready. Please check back soon.' : 'This store is currently suspended or inactive.'}</p>
      <Link href="/" className="px-6 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition">
        Return to Platform
      </Link>
    </div>
  );
}
