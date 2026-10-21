import L from 'leaflet';
import { DEFAULT_COORDS, DEFAULT_RADIUS_METERS, SAIGON_PRESETS } from './config/endpoints';
import { fetchNominatimReverse } from './services/nominatim';
import { fetchVidaOpenBuildings } from './services/openBuildings';
import { fetchOverpassData } from './services/overpass';
import { performSpatialFusion } from './services/spatialFusion';
import { BBox, PipelineTelemetry } from './types/gis';
import { BuildingBuilder } from './world/BuildingBuilder';
import { EnvironmentBuilder } from './world/EnvironmentBuilder';
import { GeoProjection } from './world/projection';
import { SceneManager } from './world/SceneManager';
import { ShipperController } from './world/ShipperController';
import { CityVegetation } from './world/CityVegetation';
import { CityTraffic, VehiclePlacement } from './world/CityTraffic';

class SaigonShipperApp {
  private sceneManager!: SceneManager;
  private shipperController!: ShipperController;

  // Geographic state
  private currentLat = DEFAULT_COORDS.lat;
  private currentLon = DEFAULT_COORDS.lon;
  private currentBBox!: BBox;

  // Leaflet map
  private leafletMap!: L.Map;
  private targetRectLayer!: L.Rectangle;
  private targetMarkerLayer!: L.Marker;

  // UI Elements
  private elAreaTitle!: HTMLElement;
  private elAreaCoords!: HTMLElement;
  private elBadgeCountry!: HTMLElement;
  private elLabelStatus!: HTMLElement;
  private elBtnBuild!: HTMLButtonElement;
  private elBtnBuildText!: HTMLElement;
  private elSpinner!: HTMLElement;
  private elBtnModeOrbit!: HTMLButtonElement;
  private elBtnModeShipper!: HTMLButtonElement;
  private elTelemetryLog!: HTMLElement;
  private elMetricDrawCalls!: HTMLElement;
  private elMetricTriangles!: HTMLElement;
  private elMetricFps!: HTMLElement;

  // Shipper HUD Elements
  private elShipperHud!: HTMLElement;
  private elSpeedValue!: HTMLElement;
  private elStreetName!: HTMLElement;
  private elSpeedometerCard!: HTMLElement;

  private isBuilding = false;

  constructor() {
    this.initDOM();
    this.init3DScene();
    this.initLeafletMinimap();
    this.bindEvents();
    this.startMetricsTicker();

    // Auto-build default area (District 1) on initial load
    this.executeBuildPipeline();
  }

  private initDOM(): void {
    this.elAreaTitle = document.getElementById('area-title')!;
    this.elAreaCoords = document.getElementById('area-coords')!;
    this.elBadgeCountry = document.getElementById('badge-country')!;
    this.elLabelStatus = document.getElementById('label-status')!;
    this.elBtnBuild = document.getElementById('btn-build-area') as HTMLButtonElement;
    this.elBtnBuildText = document.getElementById('btn-build-text')!;
    this.elSpinner = document.getElementById('build-spinner')!;
    this.elBtnModeOrbit = document.getElementById('btn-mode-orbit') as HTMLButtonElement;
    this.elBtnModeShipper = document.getElementById('btn-mode-shipper') as HTMLButtonElement;
    this.elTelemetryLog = document.getElementById('telemetry-log')!;
    this.elMetricDrawCalls = document.getElementById('metric-drawcalls')!;
    this.elMetricTriangles = document.getElementById('metric-triangles')!;
    this.elMetricFps = document.getElementById('metric-fps')!;

    this.elShipperHud = document.getElementById('shipper-hud')!;
    this.elSpeedValue = document.getElementById('hud-speed-value')!;
    this.elStreetName = document.getElementById('hud-street-name')!;
    this.elSpeedometerCard = document.getElementById('hud-speedometer-card')!;

    this.updateBBox();
  }

  private init3DScene(): void {
    const canvasContainer = document.getElementById('three-canvas-container')!;
    this.sceneManager = new SceneManager(canvasContainer);

    this.shipperController = new ShipperController(this.sceneManager.camera);
    this.sceneManager.scene.add(this.shipperController.bikeGroup);

    // Register physics/kinematics update loop
    this.sceneManager.registerUpdateHook((dt) => {
      this.shipperController.update(dt);
    });

    // Wire shipper telemetry to in-game HUD
    this.shipperController.setStatusCallback((status) => {
      this.elSpeedValue.textContent = String(status.speedKmh);
      this.elStreetName.textContent = status.currentRoadName;

      if (status.isColliding) {
        this.elSpeedometerCard.classList.add('collision-warning');
      } else {
        this.elSpeedometerCard.classList.remove('collision-warning');
      }
    });
  }

  private updateBBox(): void {
    this.currentBBox = GeoProjection.createBBoxFromRadius(
      this.currentLat,
      this.currentLon,
      DEFAULT_RADIUS_METERS
    );
  }

  private initLeafletMinimap(): void {
    // CartoDB Dark Matter tile layer
    this.leafletMap = L.map('leaflet-minimap', {
      center: [this.currentLat, this.currentLon],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(this.leafletMap);

    // Glowing target bounding box
    const bounds: L.LatLngBoundsExpression = [
      [this.currentBBox.south, this.currentBBox.west],
      [this.currentBBox.north, this.currentBBox.east],
    ];

    this.targetRectLayer = L.rectangle(bounds, {
      color: '#06b6d4',
      weight: 2,
      fillColor: '#06b6d4',
      fillOpacity: 0.15,
      dashArray: '4, 4',
    }).addTo(this.leafletMap);

    // High-tech pulse center icon
    const pulseIcon = L.divIcon({
      className: 'minimap-pulse-icon',
      html: `
        <div style="
          width: 16px;
          height: 16px;
          background: #06b6d4;
          border: 2px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 0 12px #06b6d4;
          transform: translate(-50%, -50%);
        "></div>
      `,
      iconSize: [16, 16],
    });

    this.targetMarkerLayer = L.marker([this.currentLat, this.currentLon], {
      icon: pulseIcon,
      draggable: true,
    }).addTo(this.leafletMap);

    // When marker is dragged
    this.targetMarkerLayer.on('dragend', () => {
      const pos = this.targetMarkerLayer.getLatLng();
      this.setNewCoordinates(pos.lat, pos.lng);
    });

    // When map is clicked
    this.leafletMap.on('click', (e: L.LeafletMouseEvent) => {
      this.setNewCoordinates(e.latlng.lat, e.latlng.lng);
    });
  }

  private setNewCoordinates(lat: number, lon: number): void {
    this.currentLat = lat;
    this.currentLon = lon;
    this.updateBBox();

    this.targetMarkerLayer.setLatLng([lat, lon]);
    this.targetRectLayer.setBounds([
      [this.currentBBox.south, this.currentBBox.west],
      [this.currentBBox.north, this.currentBBox.east],
    ]);

    this.leafletMap.panTo([lat, lon]);

    this.elAreaCoords.textContent = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E (~${DEFAULT_RADIUS_METERS * 2}m × ${DEFAULT_RADIUS_METERS * 2}m)`;
    this.appendTelemetryLog(`[Tọa độ] Đã chọn tâm mới: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'info');
  }

  private bindEvents(): void {
    // Build Area CTA Button
    this.elBtnBuild.addEventListener('click', () => {
      if (!this.isBuilding) {
        this.executeBuildPipeline();
      }
    });

    // Preset buttons
    const presetButtons = document.querySelectorAll<HTMLButtonElement>('.btn-preset');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.getAttribute('data-preset');
        const preset = SAIGON_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          this.setNewCoordinates(preset.lat, preset.lon);
          this.executeBuildPipeline();
        }
      });
    });

    // Mode Toggle Buttons
    this.elBtnModeOrbit.addEventListener('click', () => {
      this.switchMode('orbit');
    });

    this.elBtnModeShipper.addEventListener('click', () => {
      this.switchMode('shipper');
    });
  }

  private switchMode(mode: 'orbit' | 'shipper'): void {
    if (mode === 'orbit') {
      this.sceneManager.setCameraMode('orbit');
      this.shipperController.setActive(false);
      this.elBtnModeOrbit.classList.add('active');
      this.elBtnModeShipper.classList.remove('active');
      this.elShipperHud.style.display = 'none';
      this.appendTelemetryLog(`[Chế độ] Đã chuyển sang Góc nhìn Tự do (Orbit Camera)`, 'info');
    } else {
      this.sceneManager.setCameraMode('shipper');
      this.shipperController.setActive(true);
      this.elBtnModeShipper.classList.add('active');
      this.elBtnModeOrbit.classList.remove('active');
      this.elShipperHud.style.display = 'flex';
      this.appendTelemetryLog(`[Chế độ] Đã bật Chế độ Shipper! Dùng WASD hoặc Mũi tên để lái xe`, 'success');
    }
  }

  private appendTelemetryLog(text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    entry.textContent = `[${timeStr}] ${text}`;
    this.elTelemetryLog.appendChild(entry);
    this.elTelemetryLog.scrollTop = this.elTelemetryLog.scrollHeight;
  }

  /**
   * Main Pipeline Orchestrator
   */
  private async executeBuildPipeline(): Promise<void> {
    if (this.isBuilding) return;
    this.isBuilding = true;

    this.elBtnBuild.disabled = true;
    this.elSpinner.style.display = 'inline-block';
    this.elBtnBuildText.textContent = 'ĐANG DỰNG KHU VỰC...';
    this.elLabelStatus.style.color = '#38bdf8';
    this.elLabelStatus.textContent = '● Đang xử lý...';

    const startTime = performance.now();
    const projection = new GeoProjection(this.currentLat, this.currentLon);

    this.appendTelemetryLog(`──────────────────────────────────────────`, 'info');
    this.appendTelemetryLog(`[Pipeline] Bắt đầu dựng 3D khu vực ${this.currentLat.toFixed(4)}, ${this.currentLon.toFixed(4)}`, 'info');

    try {
      // Step 1: Nominatim Reverse Geocoding
      const nominatimPromise = fetchNominatimReverse(this.currentLat, this.currentLon).then((res) => {
        this.elAreaTitle.textContent = res.formattedTitle;
        this.elBadgeCountry.textContent = res.countryCode;
        this.appendTelemetryLog(`[Nominatim] Xác định địa chỉ: ${res.formattedTitle} [${res.countryCode}]`, 'success');
        return res;
      });

      // Step 2: OpenStreetMap Overpass with 7s multi-server race
      const overpassPromise = fetchOverpassData(this.currentBBox, (_, log, type) => {
        if (log) this.appendTelemetryLog(log, type);
      });

      // Step 3: VIDA Open Buildings via PMTiles HTTP Range
      const vidaPromise = fetchVidaOpenBuildings(this.currentBBox, (_, log, type) => {
        if (log) this.appendTelemetryLog(log, type);
      });

      // Await Overpass and VIDA (with resilience guarantees)
      const [, overpassResult, vidaBuildings] = await Promise.all([
        nominatimPromise.catch(() => null),
        overpassPromise,
        vidaPromise.catch(() => []),
      ]);

      // Step 4: Spatial Fusion & Deduplication via RBush R-Trees
      const fusionResult = performSpatialFusion(
        overpassResult.geojson,
        vidaBuildings,
        this.currentBBox,
        projection,
        (_, log, type) => {
          if (log) this.appendTelemetryLog(log, type);
        }
      );

      // Step 5: Construct 3D World in Three.js Main Thread
      this.appendTelemetryLog(`[Three.js Engine] Dựng hình học 3D & gộp Draw Calls...`, 'info');
      this.sceneManager.clearWorldObjects();

      // 5A. 3D Merged Buildings
      const cityResult = BuildingBuilder.buildCityMesh(fusionResult.buildings);
      if (cityResult) {
        this.sceneManager.scene.add(cityResult.mesh);
      }

      // 5B. 3D Merged Roads & Saigon Alleys
      const roadMesh = EnvironmentBuilder.buildRoads(fusionResult.roads);
      if (roadMesh) {
        this.sceneManager.scene.add(roadMesh);
      }

      // 5C. 3D Merged Water Bodies
      const waterMesh = EnvironmentBuilder.buildWater(fusionResult.water);
      if (waterMesh) {
        this.sceneManager.scene.add(waterMesh);
      }

      // 5D. 3D Merged Parks
      const { parkMesh } = EnvironmentBuilder.buildParks(fusionResult.parks);
      if (parkMesh) this.sceneManager.scene.add(parkMesh);

      // 5E. 1,500+ Lush Tropical Trees (InstancedMesh - 1 Draw Call)
      const treePositions: Array<{ x: number; z: number; scale?: number }> = [];

      // Trees along sidewalks, canal promenades, and courtyards (Filtered against buildings!)
      const isInsideAnyBuilding = (tx: number, tz: number) => {
        for (const b of fusionResult.buildings) {
          if (
            tx >= b.bbox.minX - 0.8 &&
            tx <= b.bbox.maxX + 0.8 &&
            tz >= b.bbox.minZ - 0.8 &&
            tz <= b.bbox.maxZ + 0.8
          ) {
            return true;
          }
        }
        return false;
      };

      for (const edge of fusionResult.roadGraph.edges) {
        if (edge.isAlley) continue; // Alleys are narrow shared spaces, keep clear for motorcycles!
        const n1 = fusionResult.roadGraph.nodes.get(edge.fromId);
        const n2 = fusionResult.roadGraph.nodes.get(edge.toId);
        if (n1 && n2) {
          const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
          const steps = Math.floor(dist / 14);
          for (let s = 1; s <= steps; s++) {
            const t = s / (steps + 1);
            const midX = n1.x + (n2.x - n1.x) * t;
            const midZ = n1.z + (n2.z - n1.z) * t;
            const perpX = -(n2.z - n1.z) / (dist || 1);
            const perpZ = (n2.x - n1.x) / (dist || 1);

            // Sidewalk tree line (5.8m from road centerline)
            const offset = 5.8;
            const t1 = { x: midX + perpX * offset, z: midZ + perpZ * offset };
            const t2 = { x: midX - perpX * offset, z: midZ - perpZ * offset };

            if (!isInsideAnyBuilding(t1.x, t1.z)) {
              treePositions.push({ x: t1.x, z: t1.z, scale: 0.85 + Math.random() * 0.35 });
            }
            if (!isInsideAnyBuilding(t2.x, t2.z)) {
              treePositions.push({ x: t2.x, z: t2.z, scale: 0.85 + Math.random() * 0.35 });
            }
          }
        }
      }

      // Trees in parks and plazas
      for (const park of fusionResult.parks) {
        const outer = park.rings[0];
        if (outer && outer.length >= 3) {
          let cx = 0, cz = 0;
          for (const pt of outer) { cx += pt.x; cz += pt.z; }
          cx /= outer.length; cz /= outer.length;
          for (let k = 0; k < 28; k++) {
            const rad = Math.random() * 45;
            const ang = Math.random() * Math.PI * 2;
            treePositions.push({
              x: cx + Math.cos(ang) * rad,
              z: cz + Math.sin(ang) * rad,
              scale: 0.9 + Math.random() * 0.6,
            });
          }
        }
      }

      const vegetationGroup = CityVegetation.createVegetation(treePositions);
      this.sceneManager.scene.add(vegetationGroup);

      // 5F. 500+ Vehicles on Streets and Alleys (InstancedMesh - 1 Draw Call)
      const vehiclePlacements: VehiclePlacement[] = [];
      for (const edge of fusionResult.roadGraph.edges) {
        const n1 = fusionResult.roadGraph.nodes.get(edge.fromId);
        const n2 = fusionResult.roadGraph.nodes.get(edge.toId);
        if (n1 && n2) {
          const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
          if (dist > 18) {
            const heading = Math.atan2(n2.x - n1.x, n2.z - n1.z);
            const count = Math.floor(dist / 22);
            for (let v = 1; v <= count; v++) {
              const t = v / (count + 1);
              const vx = n1.x + (n2.x - n1.x) * t;
              const vz = n1.z + (n2.z - n1.z) * t;
              const perpX = -(n2.z - n1.z) / (dist || 1);
              const perpZ = (n2.x - n1.x) / (dist || 1);
              const laneOffset = edge.isAlley ? 0 : 2.5 * (v % 2 === 0 ? 1 : -1);
              vehiclePlacements.push({
                x: vx + perpX * laneOffset,
                z: vz + perpZ * laneOffset,
                heading: v % 2 === 0 ? heading : heading + Math.PI,
              });
            }
          }
        }
      }

      const trafficGroup = CityTraffic.createTraffic(vehiclePlacements);
      this.sceneManager.scene.add(trafficGroup);

      // Step 6: Initialize Shipper scooter environment
      this.shipperController.setEnvironment(fusionResult.buildings, fusionResult.roadGraph);

      const totalTime = (performance.now() - startTime) / 1000;
      this.appendTelemetryLog(
        `[Đô thị Sài Gòn 3D] ~0.95 km² • ${fusionResult.buildings.length} nhà • ${treePositions.length} cây xanh • ${vehiclePlacements.length} xe cộ • Dựng xong trong ${totalTime.toFixed(1)}s (Nghiêng 53°)`,
        'success'
      );

      this.elLabelStatus.style.color = '#34d399';
      this.elLabelStatus.textContent = '● Sẵn sàng';
    } catch (err: any) {
      console.error('[Pipeline Error]', err);
      this.appendTelemetryLog(`[Lỗi Dựng Hình] ${err?.message || err}`, 'error');
      this.elLabelStatus.style.color = '#f87171';
      this.elLabelStatus.textContent = '● Lỗi';
    } finally {
      this.isBuilding = false;
      this.elBtnBuild.disabled = false;
      this.elSpinner.style.display = 'none';
      this.elBtnBuildText.textContent = '🚀 DỰNG KHU NÀY (BUILD 3D)';
    }
  }

  private startMetricsTicker(): void {
    setInterval(() => {
      const stats = this.sceneManager.getPerformanceStats();
      this.elMetricDrawCalls.textContent = String(stats.drawCalls);
      this.elMetricTriangles.textContent = Number(stats.triangles).toLocaleString();
      this.elMetricFps.textContent = String(stats.fps);

      if (stats.fps >= 50) {
        this.elMetricFps.style.color = '#34d399';
      } else if (stats.fps >= 30) {
        this.elMetricFps.style.color = '#fbbf24';
      } else {
        this.elMetricFps.style.color = '#f87171';
      }
    }, 400);
  }
}

// Boot application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new SaigonShipperApp();
});
