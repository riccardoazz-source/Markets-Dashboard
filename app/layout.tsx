import type { Metadata } from 'next';
import './globals.css';
import { ScrollNav } from '@/components/ui/ScrollNav';

export const metadata: Metadata = {
  title: 'MarketPulse – Live Markets Dashboard',
  description: 'Real-time data for global indexes, currencies, crypto, commodities and sectors.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-gray-100">
        {children}
        <ScrollNav />
      </body>
    </html>
  );
}
