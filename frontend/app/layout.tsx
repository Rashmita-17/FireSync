import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NASA FIRMS // Disaster Response & MODIS-VIIRS Harmonization Dashboard',
  description:
    'Spatio-Temporal Harmonization and Multi-Sensor Wildfire Monitoring Dashboard for Emergency Responders and Land Managers.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
      </head>
      <body className="bg-[#090D16] text-slate-100 antialiased overflow-hidden select-none">
        {children}
      </body>
    </html>
  );
}

