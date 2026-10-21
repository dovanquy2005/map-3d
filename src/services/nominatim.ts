import { ENDPOINTS } from '../config/endpoints';
import { NominatimResult } from '../types/gis';

export async function fetchNominatimReverse(lat: number, lon: number): Promise<NominatimResult> {
  const url = `${ENDPOINTS.NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
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
      'Quận 1';

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
    // Return friendly default for Saigon without crashing
    return {
      displayName: 'Bến Nghé, Quận 1, TP. Hồ Chí Minh, Việt Nam',
      wardOrNeighbourhood: 'Bến Nghé',
      district: 'Quận 1',
      city: 'TP. Hồ Chí Minh',
      countryCode: 'VN',
      formattedTitle: 'Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    };
  }
}
