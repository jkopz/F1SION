/**
 * F1SION driver utility helpers.
 */

/**
 * Country code → flag emoji mapping for all 2024 F1 drivers.
 * Uses ISO 3166-1 alpha-3 codes as returned by OpenF1.
 */
const FLAG_MAP: Record<string, string> = {
  NED: '🇳🇱', AUS: '🇦🇺', GBR: '🇬🇧', FRA: '🇫🇷', MEX: '🇲🇽',
  ESP: '🇪🇸', MON: '🇲🇨', CAN: '🇨🇦', DEN: '🇩🇰', JPN: '🇯🇵',
  THA: '🇹🇭', CHN: '🇨🇳', GER: '🇩🇪', ARG: '🇦🇷', FIN: '🇫🇮',
  ITA: '🇮🇹', BRA: '🇧🇷', USA: '🇺🇸', POL: '🇵🇱', RSA: '🇿🇦',
  SUI: '🇨🇭', BEL: '🇧🇪', AUT: '🇦🇹', POR: '🇵🇹', NZL: '🇳🇿',
  RUS: '🇷🇺', IRL: '🇮🇪',
};

export function getCountryFlag(countryCode?: string): string {
  if (!countryCode) return '';
  return FLAG_MAP[countryCode] ?? '';
}

/**
 * Known driver numbers to F1 CDN headshot URLs mapping.
 * These are the official Formula 1 driver headshots from the F1 media CDN.
 * Format: driver_number -> URL path (will be prefixed with https://media.formula1.com/content/dam/fom-website/drivers/)
 */
const DRIVER_HEADSHOTS: Record<number, string> = {
  // 2024 F1 Driver Lineup
  1: '2024/MaxVerstappen.jpg',
  11: '2024/SergioPerez.jpg',
  4: '2024/LandoNorris.jpg',
  44: '2024/LewisHamilton.jpg',
  63: '2024/GeorgeRussell.jpg',
  55: '2024/CarlosSainz.jpg',
  16: '2024/CharlesLeclerc.jpg',
  77: '2024/ValtteriBottas.jpg',
  24: '2024/GuanyuZhou.jpg',
  10: '2024/PierreGasly.jpg',
  31: '2024/EstebanOcon.jpg',
  20: '2024/KevinMagnussen.jpg',
  27: '2024/NicoHulkenberg.jpg',
  14: '2024/FernandoAlonso.jpg',
  18: '2024/LanceStroll.jpg',
  21: '2024/NyckDeVries.jpg',
  2: '2024/LoganSargeant.jpg',
  22: '2024/YukiTsunoda.jpg',
  23: '2024/AlexanderAlbon.jpg',
  3: '2024/DanielRicciardo.jpg',
  81: '2024/OscarPiastri.jpg',
  // 2023 and earlier drivers (for historical data)
  5: '2024/SebastianVettel.jpg',
  6: '2024/NicolasHulkenberg.jpg',
  7: '2023/LiamLawson.jpg',
  9: '2023/MickSchumacher.jpg',
  47: '2023/MickSchumacher.jpg',
  60: '2023/FelipeDrugovich.jpg',
  34: '2023/JackDoohan.jpg',
  // Fallback generic F1 driver image
};

const F1_CDN_BASE = 'https://media.formula1.com/content/dam/fom-website/drivers';
const FALLBACK_IMAGE = 'https://media.formula1.com/content/dam/fom-website/2024/drivers/f1-generic-driver.jpg';

/**
 * Strips the OpenF1 Cloudinary fallback prefix from headshot URLs so the
 * actual F1 media CDN image is loaded directly.
 *
 * OpenF1 returns URLs like:
 *   https://media.formula1.com/d_driver_fallback_image.png/content/dam/...
 *
 * The real image lives at:
 *   https://media.formula1.com/content/dam/...
 *
 * Also provides fallback headshots for known drivers and a generic image.
 */
export function cleanHeadshotUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  const FALLBACK_PREFIX = 'd_driver_fallback_image.png/';
  const idx = url.indexOf(FALLBACK_PREFIX);
  
  if (idx !== -1) {
    const cleaned = url.slice(idx + FALLBACK_PREFIX.length);
    // Try to extract driver number from URL or return cleaned path
    const driverMatch = cleaned.match(/drivers\/(\d+)\/|(\d+)\.jpg/);
    if (driverMatch) {
      const driverNum = parseInt(driverMatch[1] || driverMatch[2], 10);
      if (DRIVER_HEADSHOTS[driverNum]) {
        return `${F1_CDN_BASE}/${DRIVER_HEADSHOTS[driverNum]}?imw=370`;
      }
    }
    return `https://media.formula1.com/${cleaned}`;
  }

  // Check if it's already a valid F1 CDN URL
  if (url.includes('media.formula1.com')) {
    return url;
  }

  // Try to extract driver number from URL and use our mapping
  const numMatch = url.match(/(\d+)/);
  if (numMatch) {
    const driverNum = parseInt(numMatch[1], 10);
    if (DRIVER_HEADSHOTS[driverNum]) {
      return `${F1_CDN_BASE}/${DRIVER_HEADSHOTS[driverNum]}?imw=370`;
    }
  }

  // Return generic fallback
  return FALLBACK_IMAGE;
}

/**
 * Returns a formatted full name: "Max VERSTAPPEN" → "Max Verstappen"
 * Falls back to broadcast_name if full_name is unavailable.
 */
export function formatDriverName(fullName?: string, broadcastName?: string): string {
  if (fullName) {
    // OpenF1 returns "Max VERSTAPPEN" – title-case the last name part
    const parts = fullName.trim().split(' ');
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
  }
  return broadcastName ?? '';
}

