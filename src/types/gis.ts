export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface NominatimResult {
  displayName: string;
  wardOrNeighbourhood: string;
  district: string;
  city: string;
  countryCode: string;
  formattedTitle: string;
}

export interface MetricPoint {
  x: number;
  z: number;
}

export interface MetricBBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface BuildingItem {
  id: string;
  source: 'osm' | 'vida';
  name?: string;
  height: number;
  levels: number;
  color: number;
  roofColor?: number;
  isHistoric: boolean;
  isWorship: boolean;
  confidence?: number;
  // Local metric polygons: ring 0 is outer boundary, rings 1.. are holes
  rings: MetricPoint[][];
  bbox: MetricBBox;
}

export interface RoadPolygonItem {
  id: string;
  name: string;
  highway: string;
  isAlley: boolean;
  width: number;
  rings: MetricPoint[][];
  path?: MetricPoint[];
}

export interface WaterPolygonItem {
  id: string;
  name: string;
  rings: MetricPoint[][];
}

export interface ParkPolygonItem {
  id: string;
  name: string;
  rings: MetricPoint[][];
}

export interface RoadGraphNode {
  id: string;
  lat: number;
  lon: number;
  x: number;
  z: number;
  neighborIds: string[];
}

export interface RoadGraphEdge {
  fromId: string;
  toId: string;
  lengthMeters: number;
  highway: string;
  name: string;
  isAlley: boolean;
}

export interface RoadNetworkGraph {
  nodes: Map<string, RoadGraphNode>;
  edges: RoadGraphEdge[];
}

export interface SpatialFusionResult {
  buildings: BuildingItem[];
  roads: RoadPolygonItem[];
  water: WaterPolygonItem[];
  parks: ParkPolygonItem[];
  roadGraph: RoadNetworkGraph;
  telemetry: PipelineTelemetry;
}

export interface PipelineTelemetry {
  areaTitle: string;
  countryCode: string;
  overpassWinnerServer: string;
  overpassElapsedMs: number;
  osmBuildingsCount: number;
  osmRoadsCount: number;
  osmWaterCount: number;
  osmParksCount: number;
  vidaTotalFetched: number;
  vidaFilteredByConfidence: number;
  vidaFilteredByOsmBuilding: number;
  vidaFilteredByRoad: number;
  vidaFilteredByWater: number;
  vidaAccepted: number;
  totalFinalBuildings: number;
  totalRoadPolygons: number;
  totalWaterPolygons: number;
  totalParkPolygons: number;
  totalGraphNodes: number;
  totalGraphEdges: number;
  drawCalls: number;
  triangles: number;
  fps: number;
}

export type TelemetryCallback = (telemetry: Partial<PipelineTelemetry>, log?: string, logType?: 'info' | 'success' | 'warn' | 'error') => void;
