import { ENDPOINTS } from '../config/endpoints';
import { NominatimResult } from '../types/gis';

export async function fetchNominatimReverse(lat: number, lon: number): Promise<NominatimResult> {
  const url = `${ENDPOINTS.NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SaigonShipper3DRPG/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const address = data.address || {};

    const wardOrNeighbourhood =
      address.quarter ||
      address.suburb ||
      address.neighbourhood ||
      address.ward ||
      address.village ||
      '';

    const district =
      address.city_district ||
      address.district ||
      address.county ||
      'Quận Trung Tâm';

    const city =
      address.city ||
      address.state ||
      address.province ||
      'TP. Hồ Chí Minh';

    const countryCode = (address.country_code || 'vn').toUpperCase();

    const parts = [wardOrNeighbourhood, district, city].filter(Boolean);
    const formattedTitle = parts.length > 0 ? parts.join(', ') : (data.name || 'Sài Gòn - TP. Hồ Chí Minh');

    return {
      displayName: data.display_name || formattedTitle,
      wardOrNeighbourhood,
      district,
      city,
      countryCode,
      formattedTitle,
    };
  } catch (err) {
    console.warn('[Nominatim] Reverse geocoding failed, using fallback:', err);
    return {
      displayName: 'TP. Hồ Chí Minh, Việt Nam',
      wardOrNeighbourhood: 'Trung tâm',
      district: 'Sài Gòn',
      city: 'TP. Hồ Chí Minh',
      countryCode: 'VN',
      formattedTitle: 'Sài Gòn (Khu vực trung tâm)',
    };
  }
}
