export interface PresetLocation {
  id: string;
  name: string;
  district: string;
  desc: string;
  lat: number;
  lon: number;
}

export const ENDPOINTS = {
  NOMINATIM: import.meta.env.VITE_NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse',
  OVERPASS_MAIN: import.meta.env.VITE_OVERPASS_MAIN || 'https://overpass-api.de/api/interpreter',
  OVERPASS_FALLBACK_1: import.meta.env.VITE_OVERPASS_FALLBACK_1 || 'https://overpass.private.coffee/api/interpreter',
  OVERPASS_FALLBACK_2: import.meta.env.VITE_OVERPASS_FALLBACK_2 || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  VIDA_PMTILES: import.meta.env.VITE_VIDA_PMTILES_URL || 'https://data.source.coop/vida/google-microsoft-open-buildings/pmtiles/go_ms_building_footprints.pmtiles',
};

export const DEFAULT_COORDS = {
  lat: parseFloat(import.meta.env.VITE_DEFAULT_LAT || '10.7756'),
  lon: parseFloat(import.meta.env.VITE_DEFAULT_LON || '106.7019'),
};

// Expanded metropolis area: ~2,200m x 2,200m (4.84 km² = 5x area of previous 1.0 km²)
export const DEFAULT_RADIUS_METERS = 1100;

export const SAIGON_PRESETS: PresetLocation[] = [
  {
    id: 'ben-thanh',
    name: 'Chợ Bến Thành',
    district: 'Quận 1',
    desc: 'Trái tim Sài Gòn, phố xá sầm uất & chợ lịch sử',
    lat: 10.7725,
    lon: 106.6980,
  },
  {
    id: 'xom-chieu',
    name: 'Hẻm Xóm Chiếu',
    district: 'Quận 4',
    desc: 'Mê cung hẻm ẩm thực đặc trưng Sài Gòn',
    lat: 10.7602,
    lon: 106.7056,
  },
  {
    id: 'landmark-81',
    name: 'Landmark 81',
    district: 'Bình Thạnh',
    desc: 'Tòa tháp chọc trời ven sông Sài Gòn & công viên',
    lat: 10.7951,
    lon: 106.7218,
  },
  {
    id: 'cho-lon',
    name: 'Chợ Lớn (Bình Tây)',
    district: 'Quận 5',
    desc: 'Khu phố cổ người Hoa, hẻm buôn bán & hội quán',
    lat: 10.7533,
    lon: 106.6558,
  },
];

export const ROAD_BUFFER_CONFIG: Record<string, { width: number; radiusKm: number; isAlley: boolean }> = {
  motorway: { width: 14.0, radiusKm: 0.007, isAlley: false },
  motorway_link: { width: 12.0, radiusKm: 0.006, isAlley: false },
  trunk: { width: 14.0, radiusKm: 0.007, isAlley: false },
  trunk_link: { width: 12.0, radiusKm: 0.006, isAlley: false },
  primary: { width: 14.0, radiusKm: 0.007, isAlley: false },
  primary_link: { width: 10.0, radiusKm: 0.005, isAlley: false },
  secondary: { width: 9.0, radiusKm: 0.0045, isAlley: false },
  secondary_link: { width: 8.0, radiusKm: 0.004, isAlley: false },
  tertiary: { width: 9.0, radiusKm: 0.0045, isAlley: false },
  tertiary_link: { width: 7.0, radiusKm: 0.0035, isAlley: false },
  residential: { width: 6.0, radiusKm: 0.003, isAlley: false },
  unclassified: { width: 6.0, radiusKm: 0.003, isAlley: false },
  service: { width: 2.8, radiusKm: 0.0014, isAlley: true },
  living_street: { width: 3.5, radiusKm: 0.00175, isAlley: true },
  alley: { width: 2.8, radiusKm: 0.0014, isAlley: true },
  pedestrian: { width: 4.0, radiusKm: 0.002, isAlley: false },
  footway: { width: 2.5, radiusKm: 0.00125, isAlley: true },
  path: { width: 2.2, radiusKm: 0.0011, isAlley: true },
  steps: { width: 2.0, radiusKm: 0.001, isAlley: true },
};

export const SAIGON_PALETTES = {
  // Vibrant Vietnamese Architectural Wall Palettes (Matching reference image)
  cream: 0xfef9c3,
  vanillaIvory: 0xfef3c7,
  yellowOchre: 0xfacc15,
  warmGold: 0xfbbf24,
  warmOchre: 0xf59e0b,
  colonialYellow: 0xeab308,
  mintGreen: 0x86efac,
  pastelTurquoise: 0x5eead4,
  freshSage: 0xa7f3d0,
  salmonCoral: 0xfca5a5,
  salmonPeach: 0xfda4af,
  warmCoral: 0xfb923c,
  skyBlue: 0x7dd3fc,
  softPeriwinkle: 0x93c5fd,
  pearlWhite: 0xf8fafc,
  concreteGrey: 0xe2e8f0,
  concreteDark: 0x334155,
  // Modern Architectural Tower Facades & Glass Curtain Walls
  towerSlate: 0x334155,       // Slate reflective architectural glass
  towerNavy: 0x1e3a5f,        // Deep modern blue architectural glass
  towerSteel: 0x475569,       // Brushed steel & glass frame
  towerGlassBlue: 0x2563eb,   // Modern sapphire curtain wall
  towerRoofMechanical: 0x94a3b8, // Light concrete mechanical penthouse roof

  // Authentic Vietnamese Roof Tiles & Corrugated Metal Sheets (Matching reference image)
  terracottaRoof: 0xdc2626,   // Classic Vietnamese red clay tile (Ngói đỏ)
  crimsonRoof: 0xb91c1c,      // Deep crimson kiln-fired tile
  orangeRoof: 0xea580c,       // Vibrant terracotta orange tile
  cinnamonRoof: 0xc2410c,     // Rich cinnamon tile
  blueRoof: 0x2563eb,         // Popular blue corrugated metal sheet (Tôn xanh)
  sapphireRoof: 0x1d4ed8,     // Sapphire corrugated metal
  mossGreenRoof: 0x15803d,    // Moss green corrugated metal
  flatRoofTerracotta: 0xc2410c, // Terracotta rooftop patio tile
  flatRoofOchre: 0xd97706,    // Warm ochre roof deck
  flatRoofBlueMetal: 0x2563eb,// Rooftop metal shelter
  flatRoofConcrete: 0xcfd4dc, // Cool grey concrete slab deck

  // Landmarks & Institutional
  historicRed: 0xb91c1c,
  templeGold: 0xd97706,
  glassTowerCyan: 0x38bdf8,

  // Pavement & Environment
  mainAsphalt: 0x202226,
  sidewalkConcrete: 0xe2e8f0,
  alleyPavement: 0x64748b,
  tropicalWater: 0x0284c7,
  parkGreen: 0x4ade80,
};

