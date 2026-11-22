'use client';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { RISK_COLORS } from '@railguard/shared';

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export type MapMode = 'risk' | 'heat' | 'flood';
type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };

const riskColor: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'score'],
  1,
  RISK_COLORS[1],
  2,
  RISK_COLORS[2],
  3,
  RISK_COLORS[3],
  4,
  RISK_COLORS[4],
  5,
  RISK_COLORS[5],
  '#9AA5B4',
];
const exposure = (prop: string): maplibregl.ExpressionSpecification => [
  'interpolate',
  ['linear'],
  ['get', prop],
  0,
  '#2E9E5B',
  0.5,
  '#F2B01E',
  1,
  '#D62839',
];

export interface CrossingPin {
  id: string;
  name: string;
  lon: number;
  lat: number;
  status?: string;
  unit_status?: string | null;
}

interface Props {
  segments?: FC;
  detections?: FC;
  crossings?: CrossingPin[];
  mode?: MapMode;
  selectedSegmentId?: string | null;
  onSelectSegment?: (id: string) => void;
  onSelectDetection?: (id: string) => void;
  onSelectCrossing?: (id: string) => void;
  className?: string;
  /** Fit to the segment data the first time it arrives. */
  fit?: boolean;
}

export function RiskMap({
  segments,
  detections,
  crossings = [],
  mode = 'risk',
  selectedSegmentId,
  onSelectSegment,
  onSelectDetection,
  onSelectCrossing,
  className,
  fit = true,
}: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const fitted = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ segments, detections, mode, selectedSegmentId });
  const cb = useRef({ onSelectSegment, onSelectDetection, onSelectCrossing });
  latest.current = { segments, detections, mode, selectedSegmentId };
  cb.current = { onSelectSegment, onSelectDetection, onSelectCrossing };

  const apply = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { segments: s, detections: d, mode: md, selectedSegmentId: sel } = latest.current;
    (m.getSource('segments') as GeoJSONSource).setData(s ?? EMPTY);
    (m.getSource('detections') as GeoJSONSource).setData(d ?? EMPTY);
    m.setPaintProperty(
      'seg-line',
      'line-color',
      md === 'risk'
        ? riskColor
        : md === 'heat'
          ? exposure('heatExposure')
          : exposure('floodExposure'),
    );
    m.setFilter('seg-selected', ['==', ['get', 'id'], sel ?? '']);
    if (fit && !fitted.current && s?.features.length) {
      const b = new maplibregl.LngLatBounds();
      for (const f of s.features)
        for (const c of (f.geometry as GeoJSON.LineString).coordinates)
          b.extend(c as [number, number]);
      m.fitBounds(b, { padding: 50, duration: 0, maxZoom: 15 });
      fitted.current = true;
    }
  };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: OSM_STYLE,
      center: [73.0, 33.66],
      zoom: 10,
      attributionControl: { compact: true },
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('segments', { type: 'geojson', data: EMPTY, promoteId: 'id' });
      m.addSource('detections', {
        type: 'geojson',
        data: EMPTY,
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 14,
      });
      m.addLayer({
        id: 'seg-casing',
        type: 'line',
        source: 'segments',
        paint: {
          'line-color': '#fff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 5, 15, 12],
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round' },
      });
      m.addLayer({
        id: 'seg-line',
        type: 'line',
        source: 'segments',
        paint: {
          'line-color': riskColor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8],
        },
        layout: { 'line-cap': 'butt' },
      });
      m.addLayer({
        id: 'seg-selected',
        type: 'line',
        source: 'segments',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'line-color': '#0F1B2D',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 7, 15, 16],
          'line-opacity': 0.35,
        },
      });
      m.addLayer({
        id: 'det-clusters',
        type: 'circle',
        source: 'detections',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#0F1B2D',
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });
      m.addLayer({
        id: 'det-count',
        type: 'symbol',
        source: 'detections',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': '#fff' },
      });
      m.addLayer({
        id: 'det-points',
        type: 'circle',
        source: 'detections',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'severity'],
            'SEVERE',
            '#D62839',
            'MODERATE',
            '#F2B01E',
            '#6B7A90',
          ],
          'circle-radius': 6,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
        },
      });

      m.on('click', 'seg-line', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) cb.current.onSelectSegment?.(String(id));
      });
      m.on('click', 'det-points', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) cb.current.onSelectDetection?.(String(id));
      });
      m.on('click', 'det-clusters', async (e) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ['det-clusters'] })[0];
        if (!f) return;
        const zoom = await (m.getSource('detections') as GeoJSONSource).getClusterExpansionZoom(
          f.properties?.cluster_id,
        );
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
      for (const l of ['seg-line', 'det-points', 'det-clusters']) {
        m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''));
      }
      ready.current = true;
      apply();
    });
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(apply, [segments, detections, mode, selectedSegmentId]);

  // crossings as accessible DOM markers (text label + shape, not colour alone)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((x) => x.remove());
    markers.current = crossings.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = `${c.name} (${c.unit_status ?? c.status ?? 'unknown'})`;
      b.setAttribute('aria-label', `Level crossing ${c.name}`);
      const ok = c.unit_status === 'ONLINE';
      b.style.cssText = `width:28px;height:28px;border-radius:6px;border:2px solid #fff;background:${ok ? '#1FA88A' : '#E8643A'};color:#fff;font:700 13px/1 system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);cursor:pointer`;
      b.textContent = '✕';
      b.onclick = () => cb.current.onSelectCrossing?.(c.id);
      return new maplibregl.Marker({ element: b }).setLngLat([c.lon, c.lat]).addTo(m);
    });
  }, [crossings]);

  return (
    <div ref={el} className={className ?? 'h-[420px] w-full'} role="application" aria-label="Map" />
  );
}

/** Small map showing one point (detection location). */
export function MiniMap({ lon, lat, className }: { lon: number; lat: number; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: OSM_STYLE,
      center: [lon, lat],
      zoom: 15,
      attributionControl: { compact: true },
    });
    new maplibregl.Marker({ color: '#E8643A' }).setLngLat([lon, lat]).addTo(m);
    return () => m.remove();
  }, [lon, lat]);
  return <div ref={el} className={className ?? 'h-52 w-full rounded-lg'} />;
}
