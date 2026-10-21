import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import * as pbfModule from 'pbf';
import { ENDPOINTS } from '../config/endpoints';
import { BBox, TelemetryCallback } from '../types/gis';

export interface VidaBuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any;
  };
  properties: {
    id?: string | number;
    confidence?: number;
    height?: number;
    area_in_meters?: number;
    source: 'vida';
    [key: string]: any;
  };
}

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * Math.pow(2, zoom));
}

/**
 * Reads VIDA Open Buildings footprints via HTTP Byte-Range requests from PMTiles.
 * Implements graceful degradation: if S3 / Source Cooperative is slow or fails,
 * reports a warning and continues seamlessly with OSM data.
 */
export async function fetchVidaOpenBuildings(
  bbox: BBox,
  onTelemetry?: TelemetryCallback
): Promise<VidaBuildingFeature[]> {
  const startTime = performance.now();
  onTelemetry?.({}, `[VIDA PMTiles] Bắt đầu đọc Vector Tiles qua HTTP Range...`, 'info');

  const zoom = 14; // Slippy tile zoom level for building footprints
  const minTileX = lon2tile(bbox.west, zoom);
  const maxTileX = lon2tile(bbox.east, zoom);
  const minTileY = lat2tile(bbox.north, zoom);
  const maxTileY = lat2tile(bbox.south, zoom);

  const tileCoords: Array<{ z: number; x: number; y: number }> = [];
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      tileCoords.push({ z: zoom, x, y });
    }
  }

  onTelemetry?.(
    {},
    `[VIDA PMTiles] Bbox bao phủ ${tileCoords.length} ô gạch (Zoom ${zoom}: X[${minTileX}..${maxTileX}], Y[${minTileY}..${maxTileY}])`,
    'info'
  );

  const buildings: VidaBuildingFeature[] = [];

  try {
    const pmtiles = new PMTiles(ENDPOINTS.VIDA_PMTILES);
    const PbfClass = (pbfModule as any).PbfReader || pbfModule;

    // Timeout protection: 9 seconds
    const fetchWithTimeout = async (z: number, x: number, y: number) => {
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('PMTiles Byte-Range timeout (>9s)')), 9000)
      );

      const fetchPromise = (async () => {
        try {
          const resp = await pmtiles.getZxy(z, x, y);
          return resp;
        } catch (e) {
          console.warn(`[VIDA PMTiles] Tile ${z}/${x}/${y} not available:`, e);
          return null;
        }
      })();

      return Promise.race([fetchPromise, timeoutPromise]);
    };

    let tilesLoaded = 0;

    // Fetch all tiles in parallel via HTTP Byte-Range requests
    const tileResults = await Promise.all(
      tileCoords.map(async ({ z, x, y }) => {
        const resp = await fetchWithTimeout(z, x, y);
        return { z, x, y, resp };
      })
    );

    for (const { z, x, y, resp } of tileResults) {
      if (!resp || !resp.data) continue;

      tilesLoaded++;
      const pbf = new PbfClass(new Uint8Array(resp.data));
      const vt = new VectorTile(pbf);

      // Check all building layers
      for (const layerName of Object.keys(vt.layers)) {
        const layer = vt.layers[layerName];
        if (!layer) continue;

        for (let i = 0; i < layer.length; i++) {
          try {
            const rawFeature = layer.feature(i);
            const geojson = rawFeature.toGeoJSON(x, y, z) as any;

            if (geojson && (geojson.geometry.type === 'Polygon' || geojson.geometry.type === 'MultiPolygon')) {
              const props = geojson.properties || {};
              const confidence = props.confidence !== undefined ? Number(props.confidence) : undefined;
              const height = props.height !== undefined ? Number(props.height) : undefined;

              // Check rough bounding box inclusion to avoid keeping far-away polygons in the tile
              const coords = geojson.geometry.coordinates;
              const sampleLon = geojson.geometry.type === 'Polygon' ? coords[0][0][0] : coords[0][0][0][0];
              const sampleLat = geojson.geometry.type === 'Polygon' ? coords[0][0][1] : coords[0][0][0][1];

              // Margin of 0.001 to ensure boundary coverage
              if (
                sampleLat >= bbox.south - 0.001 &&
                sampleLat <= bbox.north + 0.001 &&
                sampleLon >= bbox.west - 0.001 &&
                sampleLon <= bbox.east + 0.001
              ) {
                buildings.push({
                  type: 'Feature',
                  geometry: geojson.geometry,
                  properties: {
                    ...props,
                    confidence,
                    height,
                    source: 'vida',
                  },
                });
              }
            }
          } catch (featErr) {
            // Ignore single feature decode error
          }
        }
      }
    }

    const elapsed = Math.round(performance.now() - startTime);
    onTelemetry?.(
      { vidaTotalFetched: buildings.length },
      `[VIDA PMTiles] Đọc thành công ${tilesLoaded}/${tileCoords.length} ô gạch: Lấy được ${buildings.length} tòa nhà AI (${elapsed}ms)`,
      'success'
    );

    return buildings;
  } catch (err: any) {
    console.warn('[VIDA PMTiles] Graceful degradation triggered:', err);
    onTelemetry?.(
      { vidaTotalFetched: 0 },
      `[VIDA PMTiles Cảnh báo] Không thể tải dữ liệu PMTiles (${err?.message || 'Lỗi mạng/CORS'}). Tiếp tục dựng 3D với 100% dữ liệu OSM!`,
      'warn'
    );
    return [];
  }
}
