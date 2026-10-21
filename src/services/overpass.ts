import osmtogeojson from 'osmtogeojson';
import { ENDPOINTS } from '../config/endpoints';
import { BBox, TelemetryCallback } from '../types/gis';

export interface OverpassQueryResult {
  geojson: any;
  winnerServer: string;
  elapsedMs: number;
  rawElementsCount: number;
}

/**
 * Fast & optimized Overpass QL targeting ways directly within the bbox.
 * Omits expensive relation recursions that cause public server 504 timeouts.
 */
export function buildOverpassQL(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  return `[out:json][timeout:20];
(
  way["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["waterway"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["historic"](${south},${west},${north},${east});
  way["amenity"="place_of_worship"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;
}

interface ServerEndpoint {
  id: string;
  name: string;
  url: string;
}

/**
 * Generates an offline procedural urban grid if public Overpass mirrors are completely down
 */
function createFallbackSaigonGeoJSON(bbox: BBox): any {
  const { south, west, north, east } = bbox;
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  const latSpan = north - south;
  const lonSpan = east - west;

  const features: any[] = [];

  // Main Boulevard (East-West)
  features.push({
    type: 'Feature',
    properties: { highway: 'primary', name: 'Đại lộ Sài Gòn (Mô phỏng)' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [west, midLat],
        [east, midLat],
      ],
    },
  });

  // Secondary Avenue (North-South)
  features.push({
    type: 'Feature',
    properties: { highway: 'secondary', name: 'Đường Phố Trung Tâm (Mô phỏng)' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [midLon, south],
        [midLon, north],
      ],
    },
  });

  // Alleys (Hẻm Sài Gòn)
  const alleyOffsets = [-0.3, -0.15, 0.15, 0.3];
  for (let i = 0; i < alleyOffsets.length; i++) {
    const alleyLat = midLat + alleyOffsets[i] * latSpan;
    features.push({
      type: 'Feature',
      properties: { highway: 'service', name: `Hẻm ${100 + i * 20} Sài Gòn` },
      geometry: {
        type: 'LineString',
        coordinates: [
          [west + 0.1 * lonSpan, alleyLat],
          [east - 0.1 * lonSpan, alleyLat],
        ],
      },
    });
  }

  // Canal / Waterway
  features.push({
    type: 'Feature',
    properties: { waterway: 'canal', name: 'Kênh Nhiêu Lộc - Thị Nghè' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [west, south + 0.15 * latSpan],
        [midLon, south + 0.1 * latSpan],
        [east, south + 0.18 * latSpan],
      ],
    },
  });

  // Park
  features.push({
    type: 'Feature',
    properties: { leisure: 'park', name: 'Công viên 23 Tháng 9' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west + 0.05 * lonSpan, midLat + 0.15 * latSpan],
          [midLon - 0.1 * lonSpan, midLat + 0.15 * latSpan],
          [midLon - 0.1 * lonSpan, north - 0.05 * latSpan],
          [west + 0.05 * lonSpan, north - 0.05 * latSpan],
          [west + 0.05 * lonSpan, midLat + 0.15 * latSpan],
        ],
      ],
    },
  });

  // Procedural Saigon Tube Houses (Blocks along streets)
  let bldId = 1;
  const gridRows = 5;
  const gridCols = 8;
  const bldWidth = (lonSpan * 0.7) / gridCols;
  const bldHeight = (latSpan * 0.6) / gridRows;

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      // Leave gap for central roads
      if (r === 2 || c === 3 || c === 4) continue;

      const minX = west + 0.15 * lonSpan + c * bldWidth;
      const minY = south + 0.2 * latSpan + r * bldHeight;
      const padX = bldWidth * 0.15;
      const padY = bldHeight * 0.15;

      const levels = 2 + ((r + c) % 4);
      features.push({
        type: 'Feature',
        properties: {
          building: 'residential',
          name: `Nhà phố ${bldId++}`,
          'building:levels': String(levels),
          height: String(levels * 3.5),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minX + padX, minY + padY],
              [minX + bldWidth - padX, minY + padY],
              [minX + bldWidth - padX, minY + bldHeight - padY],
              [minX + padX, minY + bldHeight - padY],
              [minX + padX, minY + padY],
            ],
          ],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Executes Overpass query using a 7-second fallback race strategy across 3 mirrors.
 */
export async function fetchOverpassData(
  bbox: BBox,
  onTelemetry?: TelemetryCallback
): Promise<OverpassQueryResult> {
  const query = buildOverpassQL(bbox);
  const startTime = performance.now();

  const servers: ServerEndpoint[] = [
    { id: 'main', name: 'Overpass DE (Chính)', url: ENDPOINTS.OVERPASS_MAIN },
    { id: 'fallback-mailru', name: 'Mail.ru OSM (Dự phòng 1)', url: ENDPOINTS.OVERPASS_FALLBACK_2 },
    { id: 'fallback-coffee', name: 'Private Coffee (Dự phòng 2)', url: ENDPOINTS.OVERPASS_FALLBACK_1 },
  ];

  const controllers = new Map<string, AbortController>();
  for (const s of servers) {
    controllers.set(s.id, new AbortController());
  }

  const queryServer = async (server: ServerEndpoint): Promise<{ data: any; server: ServerEndpoint }> => {
    const controller = controllers.get(server.id)!;
    const body = new URLSearchParams();
    body.append('data', query);

    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': 'application/json',
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Server ${server.name} returned status ${res.status}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.elements)) {
      throw new Error(`Server ${server.name} returned invalid OSM JSON`);
    }

    return { data, server };
  };

  onTelemetry?.({}, `[Overpass] Gửi truy vấn tới ${servers[0].name}...`, 'info');

  return new Promise<OverpassQueryResult>((resolve) => {
    let hasResolved = false;
    let activePendingCount = 0;
    let fallbackTimer: number | null = null;

    const resolveWithSuccess = (winningResult: { data: any; server: ServerEndpoint }) => {
      if (hasResolved) return;
      hasResolved = true;

      if (fallbackTimer) clearTimeout(fallbackTimer);

      // Abort pending losers
      for (const [id, ctrl] of controllers.entries()) {
        if (id !== winningResult.server.id) {
          ctrl.abort();
        }
      }

      const elapsedMs = Math.round(performance.now() - startTime);
      const rawElementsCount = winningResult.data.elements.length;

      onTelemetry?.(
        {
          overpassWinnerServer: winningResult.server.name,
          overpassElapsedMs: elapsedMs,
        },
        `[Overpass] Máy chủ chiến thắng: ${winningResult.server.name} (${elapsedMs}ms, ${rawElementsCount} đối tượng OSM)`,
        'success'
      );

      const geojson = osmtogeojson(winningResult.data);
      resolve({
        geojson,
        winnerServer: winningResult.server.name,
        elapsedMs,
        rawElementsCount,
      });
    };

    const tryServer = async (server: ServerEndpoint) => {
      activePendingCount++;
      try {
        const result = await queryServer(server);
        resolveWithSuccess(result);
      } catch (err: any) {
        activePendingCount--;
        onTelemetry?.({}, `[Overpass] ${server.name} cảnh báo: ${err?.message || err}`, 'warn');

        // If all mirrors failed, use procedural generation
        if (!hasResolved && activePendingCount === 0) {
          useProceduralFallback();
        }
      }
    };

    const useProceduralFallback = () => {
      if (hasResolved) return;
      hasResolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);

      onTelemetry?.(
        {},
        `[Overpass Ngoại tuyến] Máy chủ công cộng đang bận. Đã kích hoạt Bộ sinh phố Sài Gòn tự động (100% Resilience)!`,
        'success'
      );

      const geojson = createFallbackSaigonGeoJSON(bbox);
      const elapsedMs = Math.round(performance.now() - startTime);

      resolve({
        geojson,
        winnerServer: 'Bộ Sinh Phố Sài Gòn (Tự động)',
        elapsedMs,
        rawElementsCount: geojson.features.length,
      });
    };

    // 1. Fire primary server
    tryServer(servers[0]);

    // 2. Start 7-second fallback race timer
    fallbackTimer = window.setTimeout(() => {
      if (!hasResolved) {
        onTelemetry?.(
          {},
          `[Overpass] Máy chủ chính chưa phản hồi sau 7 giây. Kích hoạt ĐUA CÁC MÁY CHỦ DỰ PHÒNG đồng thời...`,
          'warn'
        );
        for (let i = 1; i < servers.length; i++) {
          tryServer(servers[i]);
        }
      }
    }, 7000);

    // Hard safety timeout: 22s max to ensure user never waits indefinitely
    setTimeout(() => {
      if (!hasResolved) {
        useProceduralFallback();
      }
    }, 22000);
  });
}
