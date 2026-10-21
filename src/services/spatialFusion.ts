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
 */
function projectRings(projection: GeoProjection, geoRings: number[][][]): MetricPoint[][] {
  return geoRings.map((ring) =>
    ring.map(([lon, lat]) => projection.project(lon, lat))
  );
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

  const osmBuildingTree = new RBush<SpatialNode>();
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
  // This guarantees waterTree is fully populated so road bridges can be accurately detected!
  // =========================================================================
  for (const feature of osmFeatures) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) continue;

    // A. OSM Buildings
    if (props.building || props.building_part) {
      osmBuildingsCount++;
      osmBuildingFeatures.push(feature);
      try {
        const [minX, minY, maxX, maxY] = turf.bbox(feature);
        osmBuildingTree.insert({ minX, minY, maxX, maxY, feature });
      } catch (e) {}
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
            waterPolygonItems.push({
              id: `water_${props.id || Math.random()}`,
              name: props.name || 'Sông / Kênh rạch',
              rings: projectRings(projection, singlePoly),
            });
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
          parkPolygonItems.push({
            id: `park_${props.id || Math.random()}`,
            name: props.name || 'Công viên cây xanh',
            rings: projectRings(projection, singlePoly),
          });
        }
      } catch (e) {}
    }
  }

  // =========================================================================
  // PASS 2: Process Roads, Alleys, Bridges & Elevated Flyovers
  // Recognizes bridges via OSM tags, positive layers, bridge names, and water cross-checks!
  // =========================================================================
  for (const feature of osmFeatures) {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom || !props.highway) continue;

    osmRoadsCount++;
    const highwayType = props.highway;
    const config = ROAD_BUFFER_CONFIG[highwayType] || { width: 5.0, radiusKm: 0.0025, isAlley: false };

    if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      try {
        // Buffer road for collision tree only (buildings & trees use this to avoid collisions)
        const buffered = turf.buffer(feature, config.radiusKm, { units: 'kilometers' });
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

        // --- COMPREHENSIVE BRIDGE RECOGNITION MECHANISM ---
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

        // Spatial Waterway Cross-Check (Automatic GIS Detection)
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

        // Base elevation for ground road
        const baseY = config.isAlley
          ? 0.078
          : highwayType === 'primary'
          ? 0.084
          : highwayType === 'secondary'
          ? 0.082
          : 0.080;

        // Vertical Elevation Profile along road vertices
        const elevationProfile: number[] = [];
        if (!isBridge) {
          for (let i = 0; i < N; i++) elevationProfile.push(baseY);
        } else {
          // Elevated bridge deck (3.8m for river bridges, 5.2m for flyovers)
          const peakH = bridgeType === 'flyover' ? 5.2 : 3.8;
          if (N <= 2) {
            elevationProfile.push(peakH, peakH);
          } else {
            // Smooth arch profile: ramps up from ground, peaks at center, ramps back to ground
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
          width: isBridge ? Math.max(config.width, 7.0) : config.width,
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

          // Grid quantize key (snap to nearest 1 meter)
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
            const prevNode: RoadGraphNode | undefined = graphNodes.get(prevNodeId);
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
                width: config.width,
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

  onTelemetry?.(
    {
      osmBuildingsCount,
      osmRoadsCount,
      osmWaterCount,
      osmParksCount,
    },
    `[Spatial Fusion] OSM đã tải: ${osmBuildingsCount} nhà, ${osmRoadsCount} đường, ${osmWaterCount} mặt nước, ${osmParksCount} công viên`,
    'info'
  );

  // 2. Filter VIDA Open Buildings using RBush spatial queries
  let vidaFilteredByConfidence = 0;
  let vidaFilteredByOsmBuilding = 0;
  let vidaFilteredByRoad = 0;
  let vidaFilteredByWater = 0;
  let vidaAccepted = 0;

  const finalBuildingItems: BuildingItem[] = [];

  // A. Process OSM Buildings first (Highest Priority)
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

    // Default height for untagged OSM building
    if (!height || isNaN(height)) {
      const hash = hashString(JSON.stringify(geom.coordinates[0]?.[0] || 'osm'));
      levels = 2 + (hash % 4); // 2 to 5 floors
      height = levels * 3.5;
    }

    let bbox: number[];
    try {
      bbox = turf.bbox(feature);
    } catch (e) {
      continue;
    }

    const [minX, minY, maxX, maxY] = bbox;
    const searchBox = { minX, minY, maxX, maxY };

    // Collision filter: discard any building whose centroid falls within the road buffer
    const roadCandidates = roadTree.search(searchBox);
    let collidesWithRoad = false;
    if (roadCandidates.length > 0) {
      try {
        const centerPt = turf.point([(minX + maxX) / 2, (minY + maxY) / 2]);
        for (const cand of roadCandidates) {
          if (turf.booleanPointInPolygon(centerPt, cand.feature)) {
            collidesWithRoad = true;
            break;
          }
        }
      } catch (e) {}
    }
    if (collidesWithRoad) continue;

    // Colors - Clean, vibrant, cheerful Saigon urban architectural palette
    let color = SAIGON_PALETTES.cream;
    if (isHistoric || isWorship) {
      color = SAIGON_PALETTES.colonialYellow;
    } else if (height > 35) {
      const towerPals = [
        SAIGON_PALETTES.towerSlate,
        SAIGON_PALETTES.towerNavy,
        SAIGON_PALETTES.towerSteel,
        SAIGON_PALETTES.towerGlassBlue,
        SAIGON_PALETTES.concreteGrey,
      ];
      color = towerPals[hashString(props.name || 'osm_tower') % towerPals.length];
    } else {
      const palList = [
        SAIGON_PALETTES.yellowOchre,
        SAIGON_PALETTES.colonialYellow,
        SAIGON_PALETTES.warmGold,
        SAIGON_PALETTES.warmOchre,
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
      const h = hashString(props.name || `bld_${height}_${Math.round(minX * 1000)}`);
      color = palList[h % palList.length];
    }

    const polyRings = extractPolygonRings(geom);
    for (const singlePoly of polyRings) {
      const rings = projectRings(projection, singlePoly);
      const bbox2D = calculateMetricBBox(rings);

      finalBuildingItems.push({
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
      });
    }
  }

  // B. Filter and Add VIDA Open Buildings
  onTelemetry?.({}, `[Spatial Fusion] Bắt đầu lọc ${vidaBuildings.length} tòa nhà VIDA bằng cây R-Tree...`, 'info');

  for (const vidaFeat of vidaBuildings) {
    const props = vidaFeat.properties || {};

    // Condition 1: High-recall confidence threshold (>= 0.60 captures dense Vietnamese tube houses)
    if (props.confidence !== undefined && props.confidence < 0.60) {
      vidaFilteredByConfidence++;
      continue;
    }

    let bbox: number[];
    try {
      bbox = turf.bbox(vidaFeat);
    } catch (e) {
      continue;
    }

    const [minX, minY, maxX, maxY] = bbox;
    const searchBox = { minX, minY, maxX, maxY };
    const centerPt = turf.point([(minX + maxX) / 2, (minY + maxY) / 2]);

    // Condition 2: Overlap with OSM Building (Only filter if centroid is inside OSM building, keeps adjacent row houses!)
    const osmCandidates = osmBuildingTree.search(searchBox);
    let collidesWithOsm = false;
    for (const cand of osmCandidates) {
      try {
        if (turf.booleanPointInPolygon(centerPt, cand.feature)) {
          collidesWithOsm = true;
          break;
        }
      } catch (e) {}
    }
    if (collidesWithOsm) {
      vidaFilteredByOsmBuilding++;
      continue;
    }

    // Condition 3: Overlap with Road (Centroid check preserves all streetfront and alley tube houses!)
    const roadCandidates = roadTree.search(searchBox);
    let collidesWithRoad = false;
    for (const cand of roadCandidates) {
      try {
        if (turf.booleanPointInPolygon(centerPt, cand.feature)) {
          collidesWithRoad = true;
          break;
        }
      } catch (e) {}
    }
    if (collidesWithRoad) {
      vidaFilteredByRoad++;
      continue;
    }

    // Condition 4: Overlap with Water (Centroid check prevents canal bank houses from being lost)
    const waterCandidates = waterTree.search(searchBox);
    let collidesWithWater = false;
    for (const cand of waterCandidates) {
      try {
        if (turf.booleanPointInPolygon(centerPt, cand.feature)) {
          collidesWithWater = true;
          break;
        }
      } catch (e) {}
    }
    if (collidesWithWater) {
      vidaFilteredByWater++;
      continue;
    }

    // VIDA Building Accepted!
    vidaAccepted++;

    const polyRings = extractPolygonRings(vidaFeat.geometry);
    for (const singlePoly of polyRings) {
      const rings = projectRings(projection, singlePoly);
      const bbox2D = calculateMetricBBox(rings);

      // Deterministic height for Saigon tube house
      const hash = hashString(JSON.stringify(singlePoly[0]?.[0] || vidaAccepted));
      const levels = 2 + (hash % 4); // 2 to 5 floors
      const height = props.height && props.height > 4 ? props.height : levels * 3.5;

      let color: number;
      if (height > 35) {
        const towerPals = [
          SAIGON_PALETTES.towerSlate,
          SAIGON_PALETTES.towerNavy,
          SAIGON_PALETTES.towerSteel,
          SAIGON_PALETTES.towerGlassBlue,
        ];
        color = towerPals[hash % towerPals.length];
      } else {
        const palList = [
          SAIGON_PALETTES.yellowOchre,
          SAIGON_PALETTES.colonialYellow,
          SAIGON_PALETTES.warmGold,
          SAIGON_PALETTES.warmOchre,
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
        color = palList[hash % palList.length];
      }

      finalBuildingItems.push({
        id: `vida_bld_${props.id || vidaAccepted}`,
        source: 'vida',
        name: 'Nhà ống Sài Gòn (AI VIDA)',
        height,
        levels,
        color,
        isHistoric: false,
        isWorship: false,
        confidence: props.confidence,
        rings,
        bbox: bbox2D,
      });
    }
  }

  const elapsed = Math.round(performance.now() - startTime);

  onTelemetry?.(
    {
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
    `[Spatial Fusion Hoàn tất] ${finalBuildingItems.length} nhà (${osmBuildingsCount} OSM + ${vidaAccepted} VIDA; Loại: ${vidaFilteredByOsmBuilding} đè OSM, ${vidaFilteredByRoad} đè đường, ${vidaFilteredByWater} đè nước) trong ${elapsed}ms`,
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
