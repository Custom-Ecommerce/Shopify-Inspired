import Link from 'next/link';
import React from 'react';

export default function StoreUnavailablePage() {
  return (
    <div className="flex flex-col items-center justify-center flex-grow p-4">
      <h1 className="text-4xl font-bold mb-4">Store Unavailable</h1>
      <p className="text-gray-600 mb-8">This store is currently suspended or inactive.</p>
      <Link href="/" className="px-6 py-2 bg-black text-white rounded-md hover:bg-gray-800 transition">
        Return to Platform
      </Link>
    </div>
  );
}
