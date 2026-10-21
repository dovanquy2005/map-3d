import osmtogeojson from 'osmtogeojson';
import { ENDPOINTS } from '../config/endpoints';
import { BBox, TelemetryCallback } from '../types/gis';

export interface OverpassQueryResult {
  geojson: any;
  winnerServer: string;
  elapsedMs: number;
  rawElementsCount: number;
}

export function buildOverpassQL(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  return `[out:json][timeout:25];
(
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
  way["highway"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
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
 * Executes Overpass query using a 7-second fallback race strategy across 3 mirrors.
 */
export async function fetchOverpassData(
  bbox: BBox,
  onTelemetry?: TelemetryCallback
): Promise<OverpassQueryResult> {
  const query = buildOverpassQL(bbox);
  const startTime = performance.now();

  const servers: ServerEndpoint[] = [
    { id: 'main', name: 'Overpass DE (Main)', url: ENDPOINTS.OVERPASS_MAIN },
    { id: 'fallback-coffee', name: 'Private Coffee (Fallback 1)', url: ENDPOINTS.OVERPASS_FALLBACK_1 },
    { id: 'fallback-mailru', name: 'Mail.ru OSM (Fallback 2)', url: ENDPOINTS.OVERPASS_FALLBACK_2 },
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

  const mainPromise = queryServer(servers[0]);

  // Race orchestration:
  let racePromise: Promise<{ data: any; server: ServerEndpoint }>;
  let fallbackTimer: number | null = null;

  const fallbackTriggerPromise = new Promise<{ data: any; server: ServerEndpoint }>((_, reject) => {
    fallbackTimer = window.setTimeout(() => {
      onTelemetry?.(
        {},
        `[Overpass] Máy chủ chính chưa phản hồi sau 7 giây. Kích hoạt ĐUA 3 MÁY CHỦ đồng thời...`,
        'warn'
      );

      const coffeePromise = queryServer(servers[1]);
      const mailRuPromise = queryServer(servers[2]);

      Promise.any([mainPromise, coffeePromise, mailRuPromise])
        .then((winner) => {
          // Cancel the others
          for (const [id, ctrl] of controllers.entries()) {
            if (id !== winner.server.id) {
              ctrl.abort();
            }
          }
        })
        .catch(() => {});
    }, 7000);
  });

  try {
    const winningResult = await Promise.race([
      mainPromise.then((res) => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        return res;
      }),
      new Promise<{ data: any; server: ServerEndpoint }>((resolve, reject) => {
        // If main finishes before 7s, this won't be reached
        setTimeout(() => {
          // After 7s, any winner can resolve
          Promise.any([mainPromise, queryServer(servers[1]), queryServer(servers[2])])
            .then(resolve)
            .catch(reject);
        }, 7050);
      }),
    ]);

    if (fallbackTimer) clearTimeout(fallbackTimer);

    // Abort losers
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

    // Convert OSM JSON to GeoJSON
    onTelemetry?.({}, `[Overpass] Chuyển đổi dữ liệu OSM sang GeoJSON...`, 'info');
    const geojson = osmtogeojson(winningResult.data);

    return {
      geojson,
      winnerServer: winningResult.server.name,
      elapsedMs,
      rawElementsCount,
    };
  } catch (err: any) {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    for (const ctrl of controllers.values()) {
      ctrl.abort();
    }
    console.error('[Overpass] All servers failed or timed out:', err);
    throw new Error(`Không thể tải dữ liệu từ Overpass API: ${err?.message || err}`);
  }
}
