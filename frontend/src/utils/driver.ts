/**
 * F1SION driver utility helpers.
 */

/**
 * Format seconds into MM:SS.sss format (F1 style)
 * e.g., 64.314 -> "1:04.314"
 */
export function formatTimeMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

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
  // 2026 F1 Driver Lineup
  1: '2026/MaxVerstappen.jpg',
  11: '2026/SergioPerez.jpg',
  4: '2026/LandoNorris.jpg',
  44: '2026/LewisHamilton.jpg',
  63: '2026/GeorgeRussell.jpg',
  55: '2026/CarlosSainz.jpg',
  16: '2026/CharlesLeclerc.jpg',
  77: '2026/ValtteriBottas.jpg',
  24: '2026/GuanyuZhou.jpg',
  10: '2026/PierreGasly.jpg',
  31: '2026/EstebanOcon.jpg',
  14: '2026/FernandoAlonso.jpg',
  18: '2026/LanceStroll.jpg',
  22: '2026/YukiTsunoda.jpg',
  23: '2026/AlexanderAlbon.jpg',
  2: '2026/LoganSargeant.jpg',
  20: '2026/KevinMagnussen.jpg',
  27: '2026/NicoHulkenberg.jpg',
  3: '2026/DanielRicciardo.jpg',
  81: '2026/OscarPiastri.jpg',
  // F2/Reserve drivers (for testing sessions)
  30: '2025/IsackHadjar.jpg',  // Hadjar - using 2025 as fallback
  38: '2025/OllieBearman.jpg', // Bearman - using 2025 as fallback
  40: '2025/AyumuIwasa.jpg',   // Iwasa
  35: '2025/FrancoColapinto.jpg', // Colapinto (placeholder for Lindblad)
  36: '2025/FrancoColapinto.jpg', // Colapinto
  // Historical drivers
  5: '2024/SebastianVettel.jpg',
  7: '2023/LiamLawson.jpg',
  9: '2023/MickSchumacher.jpg',
  47: '2023/MickSchumacher.jpg',
  60: '2023/FelipeDrugovich.jpg',
};

const F1_CDN_BASE = 'https://media.formula1.com/content/dam/fom-website/drivers';
const FALLBACK_IMAGE = 'https://media.formula1.com/content/dam/fom-website/drivers/2025/f1-generic-driver.jpg';

/**
 * Strips the OpenF1 Cloudinary fallback prefix from headshot URLs so the
 * actual F1 media CDN image is loaded directly.
 *
 * OpenF1 returns URLs like:
 *   https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/2025/MAXVER01.../maxver01.png
 *
 * The real image lives at:
 *   https://media.formula1.com/content/dam/fom-website/drivers/2025/MAXVER01.../maxver01.png
 *
 * Also provides fallback headshots for known drivers and a generic image.
 */
export function cleanHeadshotUrl(url?: string | null): string | undefined {
  if (!url) return undefined;

  const FALLBACK_PREFIX = 'd_driver_fallback_image.png/';
  const idx = url.indexOf(FALLBACK_PREFIX);
  
  if (idx !== -1) {
    const cleaned = url.slice(idx + FALLBACK_PREFIX.length);
    // Try to extract driver number from URL path (e.g., drivers/2025/MAXVER01...)
    const driverMatch = cleaned.match(/drivers[\/]\d{4}[\/]([A-Z0-9]+)_/);
    if (driverMatch) {
      // Extract driver code (e.g., MAXVER01)
      const driverCode = driverMatch[1];
      // Map driver code to known drivers
      const driverMap: Record<string, number> = {
        MAXVER01: 1,   // Max Verstappen
        SERPER01: 11,  // Sergio Perez
        LANNOR01: 4,   // Lando Norris
        LEWHAM01: 44,  // Lewis Hamilton
        GEORUS01: 63,  // George Russell
        CARSAI01: 55,  // Carlos Sainz
        CHARLE01: 16,  // Charles Leclerc
        VALBOT01: 77,  // Valtteri Bottas
        GUANYU01: 24,  // Guanyu Zhou
        PIEGAS01: 10,  // Pierre Gasly
        ESTOCO01: 31,  // Esteban Ocon
        FERALO01: 14,  // Fernando Alonso
        LANSTR01: 18, // Lance Stroll
        YUKTSU01: 22,  // Yuki Tsunoda
        ALEXALB01: 23, // Alexander Albon
        LOGSAR01: 2,   // Logan Sargeant
        KEVMAG01: 20,  // Kevin Magnussen
        NICHUL01: 27,  // Nico Hulkenberg
        DANRIC01: 3,   // Daniel Ricciardo
        OSCPIA01: 81,  // Oscar Piastri
      };
      if (driverMap[driverCode]) {
        const driverNum = driverMap[driverCode];
        if (DRIVER_HEADSHOTS[driverNum]) {
          return `${F1_CDN_BASE}/${DRIVER_HEADSHOTS[driverNum]}?imw=370`;
        }
      }
      // Fallback: use cleaned path directly
      return `https://media.formula1.com/${cleaned}`;
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

