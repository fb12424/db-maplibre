import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
} from 'maplibre-gl';

const DATA_URL = `${import.meta.env.BASE_URL}data/test1.geojson`;
const FLOOR_URL = `${import.meta.env.BASE_URL}data/dbcsd-1F-floor.geojson`;
const SOURCE_ID = 'shops';
const FLOOR_SOURCE = 'floor';
const FILL_LAYER = 'shops-fill';
const OUTLINE_LAYER = 'shops-outline';
const FLOOR_FILL_LAYER = 'floor-fill';
const FLOOR_EXTRUSION_LAYER = 'floor-extrusion';
const SHOPS_EXTRUSION_LAYER = 'shops-extrusion';
const LABEL_MIN_ZOOM = 16.3;

const FLOOR_HEIGHT = 0.25;
const SHOP_HEIGHT = 1.5;
const SELECTED_SHOP_HEIGHT = 2;
const PITCH_3D = 55;
const BEARING_3D = -18;
const PITCH_ZOOM_BOOST = 0.45;

const AREA_STOPS = [
  { max: 30, color: '#c3d9f2', label: '< 30 m²' },
  { max: 60, color: '#98bde8', label: '30–60 m²' },
  { max: 120, color: '#6597d7', label: '60–120 m²' },
  { max: 200, color: '#3c72bb', label: '120–200 m²' },
  { max: Infinity, color: '#1d4a8f', label: '≥ 200 m²' },
];

const AREA_COLOR = [
  'step',
  ['coalesce', ['get', 'area_m2'], 0],
  AREA_STOPS[0].color,
  AREA_STOPS[0].max, AREA_STOPS[1].color,
  AREA_STOPS[1].max, AREA_STOPS[2].color,
  AREA_STOPS[2].max, AREA_STOPS[3].color,
  AREA_STOPS[3].max, AREA_STOPS[4].color,
];

const FILL_COLOR = [
  'case',
  ['boolean', ['feature-state', 'hover'], false],
  '#f2a33a',
  AREA_COLOR,
];

const EXTRUSION_COLOR = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  '#f97316',
  ['boolean', ['feature-state', 'hover'], false],
  '#f2a33a',
  AREA_COLOR,
];

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });

function ringMetrics(ring) {
  const originX = ring[0][0];
  const originY = ring[0][1];
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] - originX;
    const y0 = ring[j][1] - originY;
    const x1 = ring[i][0] - originX;
    const y1 = ring[i][1] - originY;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }

  if (twiceArea === 0) {
    return { area: 0, centroid: [originX, originY] };
  }

  return {
    area: Math.abs(twiceArea / 2),
    centroid: [
      originX + x / (3 * twiceArea),
      originY + y / (3 * twiceArea),
    ],
  };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

function labelPoint(geometry) {
  const polygons =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let bestPolygon = polygons[0];
  let bestArea = -1;
  let centroid = ringMetrics(bestPolygon[0]).centroid;

  for (const polygon of polygons) {
    const metrics = ringMetrics(polygon[0]);
    if (metrics.area > bestArea) {
      bestArea = metrics.area;
      bestPolygon = polygon;
      centroid = metrics.centroid;
    }
  }

  if (pointInPolygon(centroid, bestPolygon)) return centroid;

  const ring = bestPolygon[0];
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

  let fallback = centroid;
  let bestDistance = Infinity;

  for (const fy of fractions) {
    for (const fx of fractions) {
      const candidate = [minX + (maxX - minX) * fx, minY + (maxY - minY) * fy];
      if (!pointInPolygon(candidate, bestPolygon)) continue;
      const distance =
        (candidate[0] - centroid[0]) ** 2 + (candidate[1] - centroid[1]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        fallback = candidate;
      }
    }
  }

  return fallback;
}

function featureBounds(features) {
  const bounds = new LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      bounds.extend(coords);
      return;
    }
    coords.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  return bounds;
}

function buildPopupContent(props) {
  const wrap = document.createElement('div');
  wrap.className = 'shop-popup-inner';

  const code = document.createElement('div');
  code.className = 'shop-popup-code';
  code.textContent = props.label || props.code || '未编号';

  const meta = document.createElement('div');
  meta.className = 'shop-popup-meta';
  meta.textContent = `${Number(props.area_m2).toFixed(1)} m²`;

  wrap.append(code, meta);
  return wrap;
}

function shortLabel(label) {
  return label.startsWith('1F-') ? label.slice(3) : label;
}

function labelWidth(text) {
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 0xff ? 10 : 6.4;
  }
  return width + 12;
}

function normalizeShopData(geojson) {
  const features = [];

  geojson.features.forEach((feature, index) => {
    const geometry = feature.geometry;
    let polygons = [];

    if (geometry?.type === 'Polygon') {
      polygons = [geometry.coordinates];
    } else if (geometry?.type === 'MultiPolygon') {
      polygons = geometry.coordinates;
    } else if (geometry?.type === 'GeometryCollection') {
      for (const part of geometry.geometries) {
        if (part?.type === 'Polygon') polygons.push(part.coordinates);
        else if (part?.type === 'MultiPolygon') polygons.push(...part.coordinates);
      }
    }

    if (!polygons.length) return;

    const code = (feature.properties?.code || '').trim();
    const area = Number(feature.properties?.area_m2);

    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: {
        ...feature.properties,
        code,
        label: code || '未编号',
        area_m2: Number.isFinite(area) ? area : 0,
        uid: `shop-${index}`,
      },
    });
  });

  return { type: 'FeatureCollection', features };
}

export default function App() {
  const mapContainerRef = useRef(null);
  const panelRef = useRef(null);
  const mapRef = useRef(null);
  const fitBoundsRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const popupRef = useRef(null);
  const is3DRef = useRef(true);

  const [is3D, setIs3D] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const setViewMode = (next) => {
    is3DRef.current = next;
    setIs3D(next);

    const map = mapRef.current;
    if (!map) return;

    const setVisibility = (ids, visible) => {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
      }
    };

    setVisibility([FLOOR_FILL_LAYER, FILL_LAYER, OUTLINE_LAYER], !next);
    setVisibility([FLOOR_EXTRUSION_LAYER, SHOPS_EXTRUSION_LAYER], next);
    fitBoundsRef.current?.();
  };

  useEffect(() => {
    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#eef1f6' },
          },
        ],
      },
      center: [119.30015, 26.08005],
      zoom: 18.5,
      pitch: PITCH_3D,
      bearing: BEARING_3D,
      minZoom: 15,
      maxZoom: 22,
      maxPitch: 70,
      dragRotate: true,
      pitchWithRotate: true,
    });

    mapRef.current = map;

    map.addControl(
      new NavigationControl({ showCompass: true, visualizePitch: true }),
      'top-right',
    );
    map.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: '数据：QGIS 导出 · WGS84',
      }),
      'bottom-right',
    );

    if (map.isStyleLoaded()) {
      setMapReady(true);
    } else {
      map.on('load', () => setMapReady(true));
    }

    return () => {
      map.remove();
      mapRef.current = null;
      popupRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const labels = [];
    let fitFrame = 0;

    const fitPadding = () => {
      const width = map.getContainer().clientWidth;
      const panel = panelRef.current?.getBoundingClientRect();
      if (width > 720) {
        return {
          top: 72,
          right: 72,
          bottom: 72,
          left: Math.min(width * 0.4, (panel?.right ?? 340) + 20),
        };
      }
      return {
        top: (panel?.bottom ?? 240) + 16,
        right: 48,
        bottom: 64,
        left: 48,
      };
    };

    const updateLabels = () => {
      if (!mapRef.current) return;
      const currentMap = mapRef.current;
      const zoom = currentMap.getZoom();
      const width = currentMap.getContainer().clientWidth;
      const height = currentMap.getContainer().clientHeight;

      if (zoom < LABEL_MIN_ZOOM) {
        for (const item of labels) item.el.style.display = 'none';
        return;
      }

      const rank = (uid) => {
        if (uid === selectedRef.current) return 2;
        if (uid === hoveredRef.current) return 1;
        return 0;
      };
      const ordered = labels.slice().sort((a, b) => rank(b.uid) - rank(a.uid) || b.area - a.area);
      const placed = [];

      for (const item of ordered) {
        const point = currentMap.project(item.centroid);
        const boxWidth = item.width;
        const boxHeight = 18;
        const left = point.x - boxWidth / 2 - 2;
        const top = point.y - boxHeight / 2 - 2;
        const right = left + boxWidth + 4;
        const bottom = top + boxHeight + 4;

        let visible =
          right > 0 && left < width && bottom > 0 && top < height;

        if (visible) {
          for (const box of placed) {
            if (left < box.right && right > box.left && top < box.bottom && bottom > box.top) {
              visible = false;
              break;
            }
          }
        }

        item.el.style.display = visible ? '' : 'none';
        if (visible) {
          placed.push({ left, right, top, bottom });
        }
        item.el.classList.toggle(
          'is-active',
          item.uid === selectedRef.current || item.uid === hoveredRef.current,
        );
      }
    };

    const clearSelection = () => {
      if (selectedRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: selectedRef.current }, { selected: false });
      }
      selectedRef.current = null;
      popupRef.current?.remove();
    };

    const setHover = (id) => {
      if (id === hoveredRef.current) return;
      if (hoveredRef.current) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredRef.current }, { hover: false });
      }
      hoveredRef.current = id;
      if (id) {
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
      }
      map.getCanvas().style.cursor = id ? 'pointer' : '';
      updateLabels();
    };

    const loadData = async () => {
      try {
        const [shopsResponse, floorResponse] = await Promise.all([
          fetch(DATA_URL, { signal: controller.signal }),
          fetch(FLOOR_URL, { signal: controller.signal }),
        ]);
        if (!shopsResponse.ok) throw new Error(`铺位数据 HTTP ${shopsResponse.status}`);
        if (!floorResponse.ok) throw new Error(`楼板数据 HTTP ${floorResponse.status}`);
        const [rawShops, floorGeojson] = await Promise.all([
          shopsResponse.json(),
          floorResponse.json(),
        ]);
        if (cancelled) return;

        const geojson = normalizeShopData(rawShops);
        const threeD = is3DRef.current;

        map.addSource(FLOOR_SOURCE, { type: 'geojson', data: floorGeojson });
        map.addLayer({
          id: FLOOR_FILL_LAYER,
          type: 'fill',
          source: FLOOR_SOURCE,
          layout: { visibility: threeD ? 'none' : 'visible' },
          paint: {
            'fill-color': '#fbfcfe',
            'fill-opacity': 1,
          },
        });
        map.addLayer({
          id: FLOOR_EXTRUSION_LAYER,
          type: 'fill-extrusion',
          source: FLOOR_SOURCE,
          layout: { visibility: threeD ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': '#f7f9fd',
            'fill-extrusion-height': FLOOR_HEIGHT,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
          },
        });

        map.addSource(SOURCE_ID, {
          type: 'geojson',
          data: geojson,
          promoteId: 'uid',
        });

        map.addLayer({
          id: FILL_LAYER,
          type: 'fill',
          source: SOURCE_ID,
          layout: { visibility: threeD ? 'none' : 'visible' },
          paint: {
            'fill-color': FILL_COLOR,
            'fill-opacity': 0.9,
          },
        });

        map.addLayer({
          id: OUTLINE_LAYER,
          type: 'line',
          source: SOURCE_ID,
          layout: { visibility: threeD ? 'none' : 'visible' },
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              '#f97316',
              '#ffffff',
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              3,
              1.2,
            ],
          },
        });

        map.addLayer({
          id: SHOPS_EXTRUSION_LAYER,
          type: 'fill-extrusion',
          source: SOURCE_ID,
          layout: { visibility: threeD ? 'visible' : 'none' },
          paint: {
            'fill-extrusion-color': EXTRUSION_COLOR,
            'fill-extrusion-base': FLOOR_HEIGHT,
            'fill-extrusion-height': [
              'case',
              ['boolean', ['feature-state', 'selected'], false],
              SELECTED_SHOP_HEIGHT,
              SHOP_HEIGHT,
            ],
            'fill-extrusion-opacity': 1,
            'fill-extrusion-vertical-gradient': true,
          },
        });

        const bucketCounts = AREA_STOPS.map(() => 0);
        let totalArea = 0;

        for (const feature of geojson.features) {
          const { uid, label, area_m2: area } = feature.properties;
          totalArea += area;
          const bucket = AREA_STOPS.findIndex((stop) => area < stop.max);
          bucketCounts[bucket === -1 ? AREA_STOPS.length - 1 : bucket] += 1;

          const text = shortLabel(label);
          const centroid = labelPoint(feature.geometry);
          const el = document.createElement('div');
          el.className = 'shop-label';
          el.textContent = text;
          new Marker({ element: el, anchor: 'center' })
            .setLngLat(centroid)
            .addTo(map);

          labels.push({
            uid,
            label,
            area,
            centroid,
            el,
            width: labelWidth(text),
          });
        }

        setStats({ count: geojson.features.length, totalArea, bucketCounts });

        const bounds = featureBounds(floorGeojson.features);
        const fit = (duration) => {
          const threeD = is3DRef.current;
          const camera = map.cameraForBounds(bounds, {
            padding: fitPadding(),
            maxZoom: 20,
            pitch: threeD ? PITCH_3D : 0,
            bearing: threeD ? BEARING_3D : 0,
          });
          if (!camera) return;
          map.easeTo({
            center: camera.center,
            zoom: camera.zoom + (threeD ? PITCH_ZOOM_BOOST : 0),
            pitch: threeD ? PITCH_3D : 0,
            bearing: threeD ? BEARING_3D : 0,
            duration,
          });
        };
        fitBoundsRef.current = () => fit(650);

        map.on('move', updateLabels);
        map.on('resize', updateLabels);

        fitFrame = requestAnimationFrame(() => fit(0));

        map.on('mousemove', (event) => {
          const features = map.queryRenderedFeatures(event.point, {
            layers: [FILL_LAYER, SHOPS_EXTRUSION_LAYER],
          });
          setHover(features.length ? features[0].properties.uid : null);
        });

        map.on('mouseout', () => setHover(null));

        map.on('click', (event) => {
          const features = map.queryRenderedFeatures(event.point, {
            layers: [FILL_LAYER, SHOPS_EXTRUSION_LAYER],
          });
          if (!features.length) {
            clearSelection();
            updateLabels();
            return;
          }
          const props = features[0].properties;
          const { uid } = props;
          if (selectedRef.current && selectedRef.current !== uid) {
            map.setFeatureState({ source: SOURCE_ID, id: selectedRef.current }, { selected: false });
          }
          selectedRef.current = uid;
          map.setFeatureState({ source: SOURCE_ID, id: uid }, { selected: true });
          window.alert(`选中了 ${props.label || props.code || '未编号'}`);
          popupRef.current?.remove();
          const panelBottom = panelRef.current?.getBoundingClientRect().bottom ?? 0;
          const anchor = event.point.y < panelBottom + 80 ? 'top' : 'bottom';
          popupRef.current = new Popup({
            closeButton: false,
            offset: 14,
            maxWidth: '220px',
            className: 'shop-popup',
            anchor,
          })
            .setLngLat(event.lngLat)
            .setDOMContent(buildPopupContent(props))
            .addTo(map);
          updateLabels();
        });

        map.once('idle', updateLabels);
        updateLabels();
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    };

    loadData();

    return () => {
      cancelled = true;
      controller.abort();
      cancelAnimationFrame(fitFrame);
      for (const item of labels) item.el.remove();
      hoveredRef.current = null;
      selectedRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
    };
  }, [mapReady]);

  return (
    <div className="app">
      <div ref={mapContainerRef} className="map" />

      <aside className="panel" ref={panelRef}>
        <div className="eyebrow">MAPLIBRE GL JS · DEMO</div>
        <h1>东百仓山店 · 1F 商铺</h1>
        <p className="summary">
          {stats ? (
            <>
              <strong>{stats.count}</strong> 间铺位 · 合计{' '}
              <strong>{numberFormat.format(stats.totalArea)}</strong> m²
            </>
          ) : error ? (
            '数据加载失败'
          ) : (
            '正在加载铺位数据…'
          )}
        </p>

        {error && <p className="error">读取 GeoJSON 失败：{error}</p>}

        <ul className="legend">
          {AREA_STOPS.map((stop, index) => (
            <li key={stop.label}>
              <span className="swatch" style={{ background: stop.color }} />
              <span className="legend-label">{stop.label}</span>
              <span className="legend-count">
                {stats ? `${stats.bucketCounts[index]} 间` : '—'}
              </span>
            </li>
          ))}
        </ul>

        <div className="panel-foot">
          <div className="panel-actions">
            <div className="view-switch" role="group" aria-label="视图模式">
              <button
                type="button"
                className={!is3D ? 'is-active' : ''}
                aria-pressed={!is3D}
                onClick={() => setViewMode(false)}
                disabled={!stats}
              >
                2D
              </button>
              <button
                type="button"
                className={is3D ? 'is-active' : ''}
                aria-pressed={is3D}
                onClick={() => setViewMode(true)}
                disabled={!stats}
              >
                3D
              </button>
            </div>
            <button
              type="button"
              className="fit-button"
              onClick={() => fitBoundsRef.current?.()}
              disabled={!stats}
            >
              适配全图
            </button>
          </div>
          <span className="hint">悬停高亮 · 点击查看铺位面积</span>
        </div>

        <p className="note">楼板为铺位面外扩 4 m 的近似轮廓 · 可拖动旋转/俯仰</p>
      </aside>
    </div>
  );
}
