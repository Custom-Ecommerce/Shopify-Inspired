import React from 'react';

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-100 text-gray-900 antialiased min-h-screen flex flex-col">
      {children}
    </div>
  );
}
