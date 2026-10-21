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

      // 5D. 3D Merged Parks & Trees
      const { parkMesh, treeMesh } = EnvironmentBuilder.buildParks(fusionResult.parks);
      if (parkMesh) this.sceneManager.scene.add(parkMesh);
      if (treeMesh) this.sceneManager.scene.add(treeMesh);

      // Step 6: Initialize Shipper scooter environment
      this.shipperController.setEnvironment(fusionResult.buildings, fusionResult.roadGraph);

      const totalTime = Math.round(performance.now() - startTime);
      this.appendTelemetryLog(
        `[Hoàn tất Phase 1] Đã tạo thành công thế giới 3D (${fusionResult.buildings.length} nhà, ${fusionResult.roads.length} đường/hẻm, ${fusionResult.water.length} sông hồ) trong ${totalTime}ms!`,
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
