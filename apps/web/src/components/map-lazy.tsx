'use client';
import dynamic from 'next/dynamic';
import { Skeleton } from './ui';

// maplibre-gl touches `window` on import, so it is loaded client-side only.
export const RiskMap = dynamic(() => import('./map').then((m) => m.RiskMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[320px] w-full" />,
});
export const MiniMap = dynamic(() => import('./map').then((m) => m.MiniMap), {
  ssr: false,
  loading: () => <Skeleton className="h-52 w-full" />,
});
export type { MapMode, Basemap, RailOverlay } from './map';
