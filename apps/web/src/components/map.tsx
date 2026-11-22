'use client';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { RISK_COLORS } from '@railguard/shared';

/**
 * All map sources are free, open data (no API keys, no paid service):
 *  - OpenStreetMap standard tiles; OpenTopoMap (contours / relief)
 *  - OpenRailwayMap: the REAL Pakistan Railways network from OSM (tracks, stations, max speed, signals)
 *  - AWS Terrain Tiles (Terrarium DEM, public dataset) for 3D terrain and hillshade
 */
const ORM = (style: string) =>
  ['a', 'b', 'c'].map((s) => `https://${s}.tiles.openrailwaymap.org/${style}/{z}/{x}/{y}.png`);

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
    topo: {
      type: 'raster',
      tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 17,
      attribution: '© OpenTopoMap (CC-BY-SA)',
    },
    'orm-standard': {
      type: 'raster',
      tiles: ORM('standard'),
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenRailwayMap',
    },
    'orm-maxspeed': { type: 'raster', tiles: ORM('maxspeed'), tileSize: 256, maxzoom: 19 },
    'orm-signals': { type: 'raster', tiles: ORM('signals'), tileSize: 256, maxzoom: 19 },
    dem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 14,
      encoding: 'terrarium',
      attribution: 'Terrain: Mapzen / AWS Terrain Tiles',
    },
  },
  layers: [
    { id: 'osm', type: 'raster', source: 'osm' },
    { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.35 },
    },
    {
      id: 'orm-standard',
      type: 'raster',
      source: 'orm-standard',
      paint: { 'raster-opacity': 0.85 },
    },
    {
      id: 'orm-maxspeed',
      type: 'raster',
      source: 'orm-maxspeed',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.9 },
    },
    {
      id: 'orm-signals',
      type: 'raster',
      source: 'orm-signals',
      layout: { visibility: 'none' },
      paint: { 'raster-opacity': 0.9 },
    },
  ],
};

/** Pakistan bounding box [west, south, east, north]. */
const PAKISTAN: [number, number, number, number] = [60.8, 23.6, 77.9, 37.1];

/** Tiny map button that zooms to fixed bounds (e.g. the whole national network). */
class FitControl implements maplibregl.IControl {
  private box?: HTMLDivElement;
  constructor(
    private title: string,
    private text: string,
    private bounds: [number, number, number, number],
  ) {}
  onAdd(m: MlMap) {
    this.box = document.createElement('div');
    this.box.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const b = document.createElement('button');
    b.type = 'button';
    b.title = this.title;
    b.setAttribute('aria-label', this.title);
    b.textContent = this.text;
    b.style.cssText = 'font:700 11px/1 system-ui;width:29px;height:29px';
    b.onclick = () => m.fitBounds(this.bounds, { padding: 20, pitch: 0, bearing: 0 });
    this.box.appendChild(b);
    return this.box;
  }
  onRemove() {
    this.box?.remove();
  }
}

export type Basemap = 'streets' | 'topo';
export type RailOverlay = 'none' | 'standard' | 'maxspeed' | 'signals';

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
  basemap?: Basemap;
  /** Real railway network overlay from OpenRailwayMap. */
  rail?: RailOverlay;
  /** 3D terrain (tilted view + hillshade). */
  terrain3d?: boolean;
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
  basemap = 'streets',
  rail = 'standard',
  terrain3d = false,
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
    m.addControl(
      new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
      'top-right',
    );
    m.addControl(new maplibregl.FullscreenControl(), 'top-right');
    m.addControl(
      new FitControl('Show the whole Pakistan Railways network', 'PK', PAKISTAN),
      'top-right',
    );
    m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
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
      applyView();
    });
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(apply, [segments, detections, mode, selectedSegmentId]);

  // basemap, real-railway overlay and 3D terrain
  const view = useRef({ basemap, rail, terrain3d });
  view.current = { basemap, rail, terrain3d };
  const applyView = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { basemap: b, rail: r, terrain3d: t } = view.current;
    const vis = (id: string, on: boolean) =>
      m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('osm', b === 'streets');
    vis('topo', b === 'topo');
    vis('orm-standard', r === 'standard');
    vis('orm-maxspeed', r === 'maxspeed');
    vis('orm-signals', r === 'signals');
    vis('hillshade', t);
    if (t) {
      m.setTerrain({ source: 'dem', exaggeration: 1.6 });
      if (m.getPitch() < 30) m.easeTo({ pitch: 60, duration: 800 });
    } else {
      m.setTerrain(null);
      if (m.getPitch() > 0) m.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  };
  useEffect(applyView, [basemap, rail, terrain3d]);

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
