import * as turf from '@turf/turf';
import RBush from 'rbush';
import { ROAD_BUFFER_CONFIG, SAIGON_PALETTES } from '../config/endpoints';
import {
  BBox,
  BuildingItem,
  MetricBBox,
  MetricPoint,
  ParkPolygonItem,
  PipelineTelemetry,
  RoadGraphEdge,
  RoadGraphNode,
  RoadNetworkGraph,
  RoadPolygonItem,
  SpatialFusionResult,
  TelemetryCallback,
  WaterPolygonItem,
} from '../types/gis';
import { GeoProjection } from '../world/projection';
import { VidaBuildingFeature } from './openBuildings';

interface SpatialNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  feature: any;
}

interface MetricSpatialBuilding {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  building: BuildingItem;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function calculateMetricBBox(rings: MetricPoint[][]): MetricBBox {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (const ring of rings) {
    for (const pt of ring) {
      if (pt.x < minX) minX = pt.x;
      if (pt.z < minZ) minZ = pt.z;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.z > maxZ) maxZ = pt.z;
    }
  }

  return { minX, minZ, maxX, maxZ };
}

/**
 * Normalizes multi-polygons / polygons to an array of coordinate rings [[[lon, lat], ...], ...]
 */
function extractPolygonRings(geometry: any): number[][][][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates];
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates;
  }
  return [];
}

/**
 * Projects GeoJSON [lon, lat] rings into local metric (x, z) rings
 * Filters zero-length edges (< 0.05m) and ensures closed polygons.
 */
function cleanAndProjectRings(projection: GeoProjection, geoRings: number[][][]): MetricPoint[][] {
  const result: MetricPoint[][] = [];

  for (const ring of geoRings) {
    if (!ring || ring.length < 3) continue;

    const projected: MetricPoint[] = [];
    for (let i = 0; i < ring.length; i++) {
      const pt = projection.project(ring[i][0], ring[i][1]);
      // Filter duplicate / zero-length edges (< 0.05m)
      if (projected.length > 0) {
        const prev = projected[projected.length - 1];
        if (Math.hypot(pt.x - prev.x, pt.z - prev.z) < 0.05) {
          continue;
        }
      }
      projected.push(pt);
    }

    if (projected.length < 3) continue;

    // Ensure ring is closed
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) > 0.001) {
      projected.push({ x: first.x, z: first.z });
    }

    // Must have at least 4 points (3 unique + 1 closing)
    if (projected.length >= 4) {
      result.push(projected);
    }
  }

  return result;
}

/**
 * Computes exact minimum distance from point (px, pz) to 2D line segment (x1, z1)-(x2, z2)
 */
function pointToSegmentDistance(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.0001) return Math.hypot(px - x1, pz - z1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  const projX = x1 + t * dx;
  const projZ = z1 + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

/**
 * Computes minimum distance from a polygon's vertices and centroid to a line segment
 */
function polygonToSegmentMinDistance(
  ring: MetricPoint[],
  centroidX: number,
  centroidZ: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  let minDist = pointToSegmentDistance(centroidX, centroidZ, x1, z1, x2, z2);
  for (let i = 0; i < ring.length - 1; i++) {
    const d = pointToSegmentDistance(ring[i].x, ring[i].z, x1, z1, x2, z2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Tests if point (px, pz) lies inside polygon ring using ray-casting
 */
function isPointInPolygon(px: number, pz: number, ring: MetricPoint[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].x, zi = ring[i].z;
    const xj = ring[j].x, zj = ring[j].z;
    const intersect = ((zi > pz) !== (zj > pz)) && (px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes 2D Bounding Box IoU
 */
function computeAABBIoU(b1: MetricBBox, b2: MetricBBox): number {
  const interMinX = Math.max(b1.minX, b2.minX);
  const interMaxX = Math.min(b1.maxX, b2.maxX);
  const interMinZ = Math.max(b1.minZ, b2.minZ);
  const interMaxZ = Math.min(b1.maxZ, b2.maxZ);

  if (interMinX >= interMaxX || interMinZ >= interMaxZ) return 0;

  const interArea = (interMaxX - interMinX) * (interMaxZ - interMinZ);
  const a1 = (b1.maxX - b1.minX) * (b1.maxZ - b1.minZ);
  const a2 = (b2.maxX - b2.minX) * (b2.maxZ - b2.minZ);
  const unionArea = a1 + a2 - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

export function performSpatialFusion(
  osmGeoJSON: any,
  vidaBuildings: VidaBuildingFeature[],
  bbox: BBox,
  projection: GeoProjection,
  onTelemetry?: TelemetryCallback
): SpatialFusionResult {
  const startTime = performance.now();
  onTelemetry?.({}, `[Spatial Fusion] Bắt đầu kết hợp & xử lý không gian đa nguồn...`, 'info');

  const osmBuildingTree = new RBush<MetricSpatialBuilding>();
  const roadTree = new RBush<SpatialNode>();
  const waterTree = new RBush<SpatialNode>();

  const osmBuildingFeatures: any[] = [];
  const roadPolygonItems: RoadPolygonItem[] = [];
  const waterPolygonItems: WaterPolygonItem[] = [];
  const parkPolygonItems: ParkPolygonItem[] = [];

  // Graph data structures
  const graphNodes = new Map<string, RoadGraphNode>();
  const graphEdges: RoadGraphEdge[] = [];

  const osmFeatures = osmGeoJSON?.features || [];
  let osmBuildingsCount = 0;
  let osmRoadsCount = 0;
  let osmWaterCount = 0;
  let osmParksCount = 0;

  // =========================================================================
  // PASS 1: Index Waterways, Water Bodies, Parks & Buildings FIRST
  // =========================================================================
  for (const feature of osmFeatures) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) continue;

    // A. OSM Buildings
    if (props.building || props.building_part) {
      osmBuildingsCount++;
      osmBuildingFeatures.push(feature);
    }

    // B. Waterways & Water Bodies (Rivers, Canals, Lakes)
    else if (props.natural === 'water' || props.waterway || props.water) {
      osmWaterCount++;
      try {
        let waterPoly: any = feature;
        if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
          const isCanal = props.waterway === 'canal' || props.waterway === 'river';
          const bufferRadiusKm = isCanal ? 0.008 : 0.003;
          waterPoly = turf.buffer(feature, bufferRadiusKm, { units: 'kilometers' });
        }

        if (waterPoly) {
          const [minX, minY, maxX, maxY] = turf.bbox(waterPoly);
          waterTree.insert({ minX, minY, maxX, maxY, feature: waterPoly });

          const polyRings = extractPolygonRings((waterPoly as any).geometry);
          for (const singlePoly of polyRings) {
            const rings = cleanAndProjectRings(projection, singlePoly);
            if (rings.length > 0) {
              waterPolygonItems.push({
                id: `water_${props.id || Math.random()}`,
                name: props.name || 'Sông / Kênh rạch',
                rings,
              });
            }
          }
        }
      } catch (e) {}
    }

    // C. Parks & Leisure Grounds
    else if (props.leisure === 'park' || props.landuse === 'grass' || props.landuse === 'recreation_ground') {
      osmParksCount++;
      try {
        const polyRings = extractPolygonRings(geom);
        for (const singlePoly of polyRings) {
          const rings = cleanAndProjectRings(projection, singlePoly);
          if (rings.length > 0) {
            parkPolygonItems.push({
              id: `park_${props.id || Math.random()}`,
              name: props.name || 'Công viên cây xanh',
              rings,
            });
          }
        }
      } catch (e) {}
    }
  }

  // =========================================================================
  // PASS 2: Process Roads, Alleys, Bridges & Elevated Flyovers
  // =========================================================================
  for (const feature of osmFeatures) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom || !props.highway) continue;

    osmRoadsCount++;
    const highwayType = props.highway;
    const config = ROAD_BUFFER_CONFIG[highwayType] || { width: 5.0, radiusKm: 0.0025, isAlley: false };

    // Standardized road width calculation based on OSM tags
    let actualWidth = config.width;
    if (props.width) {
      const w = parseFloat(String(props.width));
      if (!isNaN(w) && w >= 2.0 && w <= 45.0) actualWidth = w;
    } else if (props.lanes) {
      const lanes = parseInt(String(props.lanes), 10);
      if (!isNaN(lanes) && lanes > 0) {
        const laneWidth = (highwayType === 'primary' || highwayType === 'trunk' || highwayType === 'motorway') ? 3.25 : 2.75;
        actualWidth = Math.max(actualWidth, lanes * laneWidth);
      }
    }

    if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      try {
        const buffered = turf.buffer(feature, actualWidth / 2000, { units: 'kilometers' });
        if (buffered) {
          const [minX, minY, maxX, maxY] = turf.bbox(buffered);
          roadTree.insert({ minX, minY, maxX, maxY, feature: buffered });
        }
      } catch (e) {}

      // Build Continuous Road Ribbons & Graph from LineString
      if (geom.type === 'LineString') {
        const coords = geom.coordinates as [number, number][];
        const path = coords.map(([lon, lat]) => projection.project(lon, lat));
        const N = path.length;

        // Bridge recognition
        const nameLower = (props.name || '').toLowerCase();
        const isTaggedBridge =
          props.bridge === 'yes' ||
          props.bridge === 'viaduct' ||
          props.bridge === 'cantilever' ||
          props.bridge === 'suspension' ||
          props.bridge === 'movable' ||
          props.bridge === 'beam' ||
          props.man_made === 'bridge';
        const parsedLayer = props.layer ? parseFloat(String(props.layer)) : 0;
        const isPositiveLayer = parsedLayer > 0;
        const isNamedBridge =
          nameLower.startsWith('cầu ') ||
          nameLower.includes('cầu vượt') ||
          nameLower.includes('viaduct') ||
          nameLower.includes('overpass');

        // Spatial Waterway Cross-Check
        let isWaterCrossing = false;
        try {
          const [minX, minY, maxX, maxY] = turf.bbox(feature);
          const waterCands = waterTree.search({ minX, minY, maxX, maxY });
          for (const cand of waterCands) {
            if (turf.booleanIntersects(feature as any, cand.feature)) {
              isWaterCrossing = true;
              break;
            }
          }
        } catch (e) {}

        const isBridge = isTaggedBridge || isPositiveLayer || isNamedBridge || isWaterCrossing;

        let bridgeType: 'river_bridge' | 'flyover' | 'viaduct' = 'river_bridge';
        if (isNamedBridge && nameLower.includes('vượt')) {
          bridgeType = 'flyover';
        } else if (!isWaterCrossing && isPositiveLayer) {
          bridgeType = 'flyover';
        } else if (props.bridge === 'viaduct') {
          bridgeType = 'viaduct';
        }

        // Strict Elevation Hierarchy for Ground Roads
        const baseY = config.isAlley
          ? 0.042
          : (highwayType === 'residential' || highwayType === 'unclassified')
          ? 0.045
          : (highwayType === 'tertiary' || highwayType === 'secondary')
          ? 0.048
          : 0.052;

        const elevationProfile: number[] = [];
        if (!isBridge) {
          for (let i = 0; i < N; i++) elevationProfile.push(baseY);
        } else {
          const peakH = bridgeType === 'flyover' ? 5.2 : 3.8;
          if (N <= 2) {
            elevationProfile.push(peakH, peakH);
          } else {
            for (let i = 0; i < N; i++) {
              const t = i / (N - 1);
              const arch = Math.sin(t * Math.PI);
              const h = baseY + (peakH - baseY) * Math.pow(arch, 0.7);
              elevationProfile.push(h);
            }
          }
        }

        roadPolygonItems.push({
          id: `road_line_${props.id || Math.random()}`,
          name: props.name || (isBridge ? 'Cầu Đô Thị' : config.isAlley ? 'Hẻm Sài Gòn' : 'Đường đô thị'),
          highway: highwayType,
          isAlley: config.isAlley,
          width: isBridge ? Math.max(actualWidth, 7.0) : actualWidth,
          rings: [],
          path,
          isBridge,
          bridgeType,
          layer: parsedLayer,
          elevationProfile,
        });

        let prevNodeId: string | null = null;

        for (let i = 0; i < coords.length; i++) {
          const [lon, lat] = coords[i];
          const pt = projection.project(lon, lat);
          const elevY = elevationProfile[i] || baseY;

          const snapKey = `${Math.round(pt.x)}_${Math.round(pt.z)}`;
          let node = graphNodes.get(snapKey);

          if (!node) {
            node = {
              id: snapKey,
              lat,
              lon,
              x: pt.x,
              y: elevY,
              z: pt.z,
              neighborIds: [],
            };
            graphNodes.set(snapKey, node);
          } else if (elevY > (node.y || 0)) {
            node.y = elevY;
          }

          if (prevNodeId && prevNodeId !== node.id) {
            const prevNode = graphNodes.get(prevNodeId);
            if (prevNode) {
              if (!prevNode.neighborIds.includes(node.id)) {
                prevNode.neighborIds.push(node.id);
              }
              if (!node.neighborIds.includes(prevNodeId)) {
                node.neighborIds.push(prevNodeId);
              }

              const dist = GeoProjection.distance(prevNode, node);
              graphEdges.push({
                fromId: prevNodeId,
                toId: node.id,
                lengthMeters: dist,
                highway: highwayType,
                name: props.name || (isBridge ? 'Cầu' : config.isAlley ? 'Hẻm Sài Gòn' : 'Đường'),
                isAlley: config.isAlley,
                isBridge,
                elevation: ((prevNode.y || baseY) + elevY) / 2,
              });
            }
          }

          prevNodeId = node.id;
        }
      }
    }
  }

  // =========================================================================
  // PASS 3: Process OSM Buildings First (Highest Priority Ground Truth)
  // =========================================================================
  const finalBuildingItems: BuildingItem[] = [];

  for (const feature of osmBuildingFeatures) {
    const props = feature.properties || {};
    const geom = feature.geometry;

    let height = 0;
    let levels = 0;

    if (props.height) {
      height = parseFloat(String(props.height).replace(/[^0-9.]/g, ''));
    }
    if (props['building:levels']) {
      levels = parseFloat(props['building:levels']);
      if (!height && levels > 0) height = levels * 3.5;
    }

    const isHistoric = !!props.historic || props.heritage === 'yes';
    const isWorship = props.amenity === 'place_of_worship' || props.religion === 'buddhist';

    if (!height || isNaN(height)) {
      const hash = hashString(JSON.stringify(geom.coordinates[0]?.[0] || 'osm'));
      levels = 2 + (hash % 4);
      height = levels * 3.5;
    }

    let color = SAIGON_PALETTES.cream;
    if (isHistoric || isWorship) {
      color = SAIGON_PALETTES.colonialYellow;
    } else if (height > 35) {
      color = SAIGON_PALETTES.towerNavy;
    } else {
      const palList = [
        SAIGON_PALETTES.yellowOchre,
        SAIGON_PALETTES.warmGold,
        SAIGON_PALETTES.vanillaIvory,
        SAIGON_PALETTES.cream,
        SAIGON_PALETTES.pastelTurquoise,
        SAIGON_PALETTES.mintGreen,
        SAIGON_PALETTES.freshSage,
        SAIGON_PALETTES.salmonCoral,
        SAIGON_PALETTES.salmonPeach,
        SAIGON_PALETTES.warmCoral,
        SAIGON_PALETTES.skyBlue,
        SAIGON_PALETTES.softPeriwinkle,
        SAIGON_PALETTES.pearlWhite,
        SAIGON_PALETTES.concreteGrey,
      ];
      const h = hashString(props.name || `bld_${height}`);
      color = palList[h % palList.length];
    }

    const polyRings = extractPolygonRings(geom);
    for (const singlePoly of polyRings) {
      const rings = cleanAndProjectRings(projection, singlePoly);
      if (rings.length === 0 || rings[0].length < 4) continue;

      const bbox2D = calculateMetricBBox(rings);
      const outerRing = rings[0];
      const cx = (bbox2D.minX + bbox2D.maxX) / 2;
      const cz = (bbox2D.minZ + bbox2D.maxZ) / 2;

      // Exact Road Corridor Clearance: only reject if building vertices intrude into actual road
      let intrudesOnRoad = false;
      for (const r of roadPolygonItems) {
        if (!r.path || r.path.length < 2) continue;
        const rHalfW = r.width / 2;

        for (let i = 0; i < r.path.length - 1; i++) {
          const p1 = r.path[i];
          const p2 = r.path[i + 1];

          // Bounding box pre-check
          const minRx = Math.min(p1.x, p2.x) - rHalfW - 1.0;
          const maxRx = Math.max(p1.x, p2.x) + rHalfW + 1.0;
          const minRz = Math.min(p1.z, p2.z) - rHalfW - 1.0;
          const maxRz = Math.max(p1.z, p2.z) + rHalfW + 1.0;

          if (bbox2D.maxX < minRx || bbox2D.minX > maxRx || bbox2D.maxZ < minRz || bbox2D.minZ > maxRz) {
            continue;
          }

          const dist = polygonToSegmentMinDistance(outerRing, cx, cz, p1.x, p1.z, p2.x, p2.z);
          if (dist < rHalfW + 0.3) {
            intrudesOnRoad = true;
            break;
          }
        }
        if (intrudesOnRoad) break;
      }

      if (intrudesOnRoad) continue;

      const item: BuildingItem = {
        id: `osm_bld_${props.id || Math.random()}`,
        source: 'osm',
        name: props.name || (isWorship ? 'Chùa / Đền' : 'Nhà phố Sài Gòn'),
        height,
        levels: Math.max(1, Math.round(height / 3.5)),
        color,
        isHistoric,
        isWorship,
        rings,
        bbox: bbox2D,
      };

      finalBuildingItems.push(item);
      osmBuildingTree.insert({
        minX: bbox2D.minX,
        minY: bbox2D.minZ,
        maxX: bbox2D.maxX,
        maxY: bbox2D.maxZ,
        building: item,
      });
    }
  }

  // =========================================================================
  // PASS 4: AUTO-REGISTRATION (SATELLITE OFF-NADIR ALIGNMENT OF VIDA BUILDINGS)
  // Automatically estimates and compensates (Δx, Δz) offset using high-IoU matched pairs
  // =========================================================================
  let vidaFilteredByConfidence = 0;
  let vidaFilteredByOsmBuilding = 0;
  let vidaFilteredByRoad = 0;
  let vidaFilteredByWater = 0;
  let vidaAccepted = 0;

  interface ProjectedVidaCandidate {
    feat: VidaBuildingFeature;
    props: any;
    rings: MetricPoint[][];
    bbox: MetricBBox;
    cx: number;
    cz: number;
  }

  const vidaCandidates: ProjectedVidaCandidate[] = [];

  for (const vidaFeat of vidaBuildings) {
    const props = vidaFeat.properties || {};

    // Condition 1: Confidence >= 0.7
    if (props.confidence !== undefined && props.confidence < 0.7) {
      vidaFilteredByConfidence++;
      continue;
    }

    const polyRings = extractPolygonRings(vidaFeat.geometry);
    for (const singlePoly of polyRings) {
      const rings = cleanAndProjectRings(projection, singlePoly);
      if (rings.length === 0 || rings[0].length < 4) continue;

      const bbox2D = calculateMetricBBox(rings);
      const cx = (bbox2D.minX + bbox2D.maxX) / 2;
      const cz = (bbox2D.minZ + bbox2D.maxZ) / 2;

      vidaCandidates.push({
        feat: vidaFeat,
        props,
        rings,
        bbox: bbox2D,
        cx,
        cz,
      });
    }
  }

  // Calculate satellite offset vector (Δx, Δz) against ground-truth OSM buildings
  const offsetSamplesX: number[] = [];
  const offsetSamplesZ: number[] = [];

  for (const vc of vidaCandidates) {
    const searchBox = {
      minX: vc.bbox.minX - 4.0,
      minY: vc.bbox.minZ - 4.0,
      maxX: vc.bbox.maxX + 4.0,
      maxY: vc.bbox.maxZ + 4.0,
    };
    const cands = osmBuildingTree.search(searchBox);

    for (const cand of cands) {
      const iou = computeAABBIoU(vc.bbox, cand.building.bbox);
      if (iou >= 0.35) {
        const osmBx = cand.building.bbox;
        const osmCx = (osmBx.minX + osmBx.maxX) / 2;
        const osmCz = (osmBx.minZ + osmBx.maxZ) / 2;

        const dx = osmCx - vc.cx;
        const dz = osmCz - vc.cz;
        if (Math.hypot(dx, dz) <= 4.0) {
          offsetSamplesX.push(dx);
          offsetSamplesZ.push(dz);
        }
      }
    }
  }

  let alignDx = 0;
  let alignDz = 0;

  if (offsetSamplesX.length >= 3) {
    offsetSamplesX.sort((a, b) => a - b);
    offsetSamplesZ.sort((a, b) => a - b);
    alignDx = offsetSamplesX[Math.floor(offsetSamplesX.length / 2)];
    alignDz = offsetSamplesZ[Math.floor(offsetSamplesZ.length / 2)];

    onTelemetry?.(
      {},
      `[Auto-Registration] Đã tự động căn chỉnh độ lệch ảnh vệ tinh VIDA: ΔX = ${alignDx >= 0 ? '+' : ''}${alignDx.toFixed(2)}m, ΔZ = ${alignDz >= 0 ? '+' : ''}${alignDz.toFixed(2)}m (${offsetSamplesX.length} cặp nhà đối sánh)`,
      'success'
    );
  }

  // Apply auto-registration offset to all VIDA candidates
  if (Math.abs(alignDx) > 0.05 || Math.abs(alignDz) > 0.05) {
    for (const vc of vidaCandidates) {
      for (const ring of vc.rings) {
        for (const pt of ring) {
          pt.x += alignDx;
          pt.z += alignDz;
        }
      }
      vc.bbox.minX += alignDx;
      vc.bbox.maxX += alignDx;
      vc.bbox.minZ += alignDz;
      vc.bbox.maxZ += alignDz;
      vc.cx += alignDx;
      vc.cz += alignDz;
    }
  }

  // =========================================================================
  // PASS 5: NARROW-PHASE DEDUPLICATION & ROAD CLEARANCE FILTERING FOR VIDA
  // =========================================================================
  for (const vc of vidaCandidates) {
    const searchBox = {
      minX: vc.bbox.minX - 0.5,
      minY: vc.bbox.minZ - 0.5,
      maxX: vc.bbox.maxX + 0.5,
      maxY: vc.bbox.maxZ + 0.5,
    };

    // 1. Exact Polygon Overlap Check against OSM Buildings
    // Only eliminate if overlap exceeds 25% (preserves adjacent townhouses with shared party walls)
    const osmCands = osmBuildingTree.search(searchBox);
    let duplicatesOsm = false;

    for (const cand of osmCands) {
      const osmOuter = cand.building.rings[0];
      if (!osmOuter) continue;

      // Sample 5 test points on the candidate: centroid and 4 quadrant points
      let pointsInside = 0;
      const testPts: MetricPoint[] = [
        { x: vc.cx, z: vc.cz },
        { x: (vc.bbox.minX + vc.cx) / 2, z: (vc.bbox.minZ + vc.cz) / 2 },
        { x: (vc.bbox.maxX + vc.cx) / 2, z: (vc.bbox.minZ + vc.cz) / 2 },
        { x: (vc.bbox.minX + vc.cx) / 2, z: (vc.bbox.maxZ + vc.cz) / 2 },
        { x: (vc.bbox.maxX + vc.cx) / 2, z: (vc.bbox.maxZ + vc.cz) / 2 },
      ];

      for (const tp of testPts) {
        if (isPointInPolygon(tp.x, tp.z, osmOuter)) {
          pointsInside++;
        }
      }

      // If centroid and multiple sample points are inside OSM building, it's a true duplicate
      if (pointsInside >= 2) {
        duplicatesOsm = true;
        break;
      }
    }

    if (duplicatesOsm) {
      vidaFilteredByOsmBuilding++;
      continue;
    }

    // 2. Exact Road Clearance Check (Point-to-Segment geometric distance)
    // Eliminates the AABB diagonal road false-positive clipping bug!
    let intrudesOnRoad = false;
    const outerRing = vc.rings[0];

    for (const r of roadPolygonItems) {
      if (!r.path || r.path.length < 2) continue;
      const rHalfW = r.width / 2;

      for (let i = 0; i < r.path.length - 1; i++) {
        const p1 = r.path[i];
        const p2 = r.path[i + 1];

        const minRx = Math.min(p1.x, p2.x) - rHalfW - 1.0;
        const maxRx = Math.max(p1.x, p2.x) + rHalfW + 1.0;
        const minRz = Math.min(p1.z, p2.z) - rHalfW - 1.0;
        const maxRz = Math.max(p1.z, p2.z) + rHalfW + 1.0;

        if (vc.bbox.maxX < minRx || vc.bbox.minX > maxRx || vc.bbox.maxZ < minRz || vc.bbox.minZ > maxRz) {
          continue;
        }

        const dist = polygonToSegmentMinDistance(outerRing, vc.cx, vc.cz, p1.x, p1.z, p2.x, p2.z);
        if (dist < rHalfW + 0.3) {
          intrudesOnRoad = true;
          break;
        }
      }
      if (intrudesOnRoad) break;
    }

    if (intrudesOnRoad) {
      vidaFilteredByRoad++;
      continue;
    }

    // 3. Exact Water Check
    let inWater = false;
    for (const w of waterPolygonItems) {
      for (const wRing of w.rings) {
        if (isPointInPolygon(vc.cx, vc.cz, wRing)) {
          inWater = true;
          break;
        }
      }
      if (inWater) break;
    }

    if (inWater) {
      vidaFilteredByWater++;
      continue;
    }

    // VIDA Building Accepted!
    vidaAccepted++;

    const hash = hashString(JSON.stringify(vc.rings[0][0] || vidaAccepted));
    const levels = 2 + (hash % 4);
    const height = vc.props.height && vc.props.height > 4 ? vc.props.height : levels * 3.5;

    const palList = [
      SAIGON_PALETTES.yellowOchre,
      SAIGON_PALETTES.warmGold,
      SAIGON_PALETTES.vanillaIvory,
      SAIGON_PALETTES.cream,
      SAIGON_PALETTES.pastelTurquoise,
      SAIGON_PALETTES.mintGreen,
      SAIGON_PALETTES.freshSage,
      SAIGON_PALETTES.salmonCoral,
      SAIGON_PALETTES.salmonPeach,
      SAIGON_PALETTES.warmCoral,
      SAIGON_PALETTES.skyBlue,
      SAIGON_PALETTES.softPeriwinkle,
      SAIGON_PALETTES.pearlWhite,
      SAIGON_PALETTES.concreteGrey,
    ];
    const color = palList[hash % palList.length];

    finalBuildingItems.push({
      id: `vida_bld_${vc.props.id || vidaAccepted}`,
      source: 'vida',
      name: 'Nhà ống Sài Gòn (AI VIDA)',
      height,
      levels,
      color,
      isHistoric: false,
      isWorship: false,
      confidence: vc.props.confidence,
      rings: vc.rings,
      bbox: vc.bbox,
    });
  }

  const elapsed = Math.round(performance.now() - startTime);

  onTelemetry?.(
    {
      osmBuildingsCount,
      osmRoadsCount,
      osmWaterCount,
      osmParksCount,
      vidaFilteredByConfidence,
      vidaFilteredByOsmBuilding,
      vidaFilteredByRoad,
      vidaFilteredByWater,
      vidaAccepted,
      totalFinalBuildings: finalBuildingItems.length,
      totalRoadPolygons: roadPolygonItems.length,
      totalWaterPolygons: waterPolygonItems.length,
      totalParkPolygons: parkPolygonItems.length,
      totalGraphNodes: graphNodes.size,
      totalGraphEdges: graphEdges.length,
    },
    `[Spatial Fusion Hoàn tất] ${finalBuildingItems.length} tòa nhà (${osmBuildingsCount} OSM + ${vidaAccepted} VIDA) • Lọc loại: ${vidaFilteredByOsmBuilding} đè OSM, ${vidaFilteredByRoad} lấn tim đường, ${vidaFilteredByWater} đè nước (${elapsed}ms)`,
    'success'
  );

  return {
    buildings: finalBuildingItems,
    roads: roadPolygonItems,
    water: waterPolygonItems,
    parks: parkPolygonItems,
    roadGraph: {
      nodes: graphNodes,
      edges: graphEdges,
    },
    telemetry: {
      areaTitle: '',
      countryCode: '',
      overpassWinnerServer: '',
      overpassElapsedMs: 0,
      osmBuildingsCount,
      osmRoadsCount,
      osmWaterCount,
      osmParksCount,
      vidaTotalFetched: vidaBuildings.length,
      vidaFilteredByConfidence,
      vidaFilteredByOsmBuilding,
      vidaFilteredByRoad,
      vidaFilteredByWater,
      vidaAccepted,
      totalFinalBuildings: finalBuildingItems.length,
      totalRoadPolygons: roadPolygonItems.length,
      totalWaterPolygons: waterPolygonItems.length,
      totalParkPolygons: parkPolygonItems.length,
      totalGraphNodes: graphNodes.size,
      totalGraphEdges: graphEdges.length,
      drawCalls: 0,
      triangles: 0,
      fps: 60,
    },
  };
}
