/* ============================================================
   SKYLINE — script.js
   ------------------------------------------------------------
   No API key anywhere in this file — every service used here is
   free for client-side use:
     - Open-Meteo Forecast API     https://open-meteo.com
     - Open-Meteo Geocoding API    (place name -> coordinates)
     - BigDataCloud reverse geocode (coordinates -> place name)

   Sections in this file:
     1. Configuration & the WMO weather-code table
     2. Small DOM helpers
     3. Hand-drawn weather icon set (inline SVG strings)
     4. API calls
     5. Theme switching
     6. Rendering: current conditions + 7-day forecast
     7. Location search (debounced autocomplete combobox)
     8. Geolocation bootstrap (with graceful fallback)
     9. Living sky: canvas rain/snow, star field, lightning
    10. Scroll reveal
    11. Init
   ============================================================ */


/* ---------- 1. Configuration & the WMO weather-code table ---------- */

const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODE_API = 'https://api.bigdatacloud.net/data/reverse-geocode-client';

// Used only if the browser can't get a location AND reverse lookup of the
// IP-based position also fails. Change this to whichever city makes sense
// for you — it's just a starting point, never shown as "your location".
const FALLBACK_LOCATION = {
  name: 'Kolkata',
  admin1: 'West Bengal',
  country: 'India',
  latitude: 22.5726,
  longitude: 88.3639,
};

// Open-Meteo returns a numeric WMO weather code (a meteorological
// standard, not something specific to this API). This table turns each
// code into a plain-language description and a broad "group" that
// drives both the sky theme and which icon/particles are shown.
const WMO_CODES = {
  0: { desc: 'Clear sky', group: 'clear' },
  1: { desc: 'Mainly clear', group: 'clear' },
  2: { desc: 'Partly cloudy', group: 'cloudy' },
  3: { desc: 'Overcast', group: 'cloudy' },
  45: { desc: 'Foggy', group: 'fog' },
  48: { desc: 'Rime fog', group: 'fog' },
  51: { desc: 'Light drizzle', group: 'rain' },
  53: { desc: 'Drizzle', group: 'rain' },
  55: { desc: 'Dense drizzle', group: 'rain' },
  56: { desc: 'Freezing drizzle', group: 'rain' },
  57: { desc: 'Freezing drizzle', group: 'rain' },
  61: { desc: 'Light rain', group: 'rain' },
  63: { desc: 'Rain', group: 'rain' },
  65: { desc: 'Heavy rain', group: 'rain' },
  66: { desc: 'Freezing rain', group: 'rain' },
  67: { desc: 'Freezing rain', group: 'rain' },
  71: { desc: 'Light snow', group: 'snow' },
  73: { desc: 'Snow', group: 'snow' },
  75: { desc: 'Heavy snow', group: 'snow' },
  77: { desc: 'Snow grains', group: 'snow' },
  80: { desc: 'Light showers', group: 'rain' },
  81: { desc: 'Showers', group: 'rain' },
  82: { desc: 'Violent showers', group: 'rain' },
  85: { desc: 'Snow showers', group: 'snow' },
  86: { desc: 'Heavy snow showers', group: 'snow' },
  95: { desc: 'Thunderstorm', group: 'thunder' },
  96: { desc: 'Thunderstorm with hail', group: 'thunder' },
  99: { desc: 'Severe thunderstorm', group: 'thunder' },
};

// Which of the two glass modes (see styles.css) each sky theme pairs
// with. Day skies default to light glass; night skies default to dark
// glass; rain and thunder are moody enough to stay dark even by day.
const DARK_GLASS_THEMES = new Set([
  'clear-night', 'cloudy-night', 'fog-night',
  'rain-day', 'rain-night',
  'snow-night',
  'thunder-day', 'thunder-night',
]);


/* ---------- 2. Small DOM helpers ---------- */

const $ = (id) => document.getElementById(id);

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function setStatus(message) {
  const el = $('status-message');
  el.textContent = message;
  el.hidden = !message;
}


/* ---------- 3. Hand-drawn weather icon set ----------
   Simple, monochrome (currentColor) SVGs built from basic shapes so
   they always pick up the active theme's accent colour in CSS. */

const ICONS = {
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.3" fill="currentColor" stroke="none"/><line x1="12" y1="1.6" x2="12" y2="4.1"/><line x1="12" y1="19.9" x2="12" y2="22.4"/><line x1="1.6" y1="12" x2="4.1" y2="12"/><line x1="19.9" y1="12" x2="22.4" y2="12"/><line x1="4.5" y1="4.5" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.5" y2="19.5"/><line x1="4.5" y1="19.5" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.5" y2="4.5"/></svg>`,

  moon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.3a9.7 9.7 0 1 0 8.5 14.6 8.2 8.2 0 0 1-8.5-14.6z"/></svg>`,

  cloud: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="13" r="3.3"/><circle cx="12.6" cy="10.1" r="4.3"/><circle cx="17" cy="13.1" r="3.1"/><rect x="6" y="13" width="13" height="5.4" rx="2.7"/></svg>`,

  cloudSun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="7.5" y1="1" x2="7.5" y2="2.4"/><line x1="2.2" y1="6.6" x2="3.6" y2="6.6"/><line x1="3.4" y1="2.5" x2="4.4" y2="3.5"/><circle cx="7.5" cy="6.6" r="2.7" fill="currentColor" stroke="none"/><g fill="currentColor" stroke="none"><circle cx="9" cy="15.6" r="3"/><circle cx="13" cy="13" r="3.9"/><circle cx="16.8" cy="15.6" r="2.8"/><rect x="7.2" y="15.6" width="11.8" height="4.9" rx="2.45"/></g></svg>`,

  cloudMoon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 1.8a5.3 5.3 0 0 0 4.6 6.7 4.5 4.5 0 0 1-4.6-6.7z"/><g><circle cx="9" cy="15.6" r="3"/><circle cx="13" cy="13" r="3.9"/><circle cx="16.8" cy="15.6" r="2.8"/><rect x="7.2" y="15.6" width="11.8" height="4.9" rx="2.45"/></g></svg>`,

  fog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="4" y1="8" x2="16" y2="8"/><line x1="2" y1="12.5" x2="20" y2="12.5"/><line x1="5" y1="17" x2="19" y2="17"/><line x1="8" y1="21" x2="16" y2="21"/></svg>`,

  drizzle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><g fill="currentColor" stroke="none"><circle cx="8" cy="10.4" r="3"/><circle cx="12.6" cy="7.8" r="3.9"/><circle cx="16.8" cy="10.4" r="2.8"/><rect x="6" y="10.4" width="13.6" height="4.6" rx="2.3"/></g><line x1="9" y1="18" x2="8" y2="20.2"/><line x1="13" y1="18" x2="12" y2="20.2"/><line x1="17" y1="18" x2="16" y2="20.2"/></svg>`,

  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><g fill="currentColor" stroke="none"><circle cx="8" cy="9.4" r="3"/><circle cx="12.6" cy="6.8" r="3.9"/><circle cx="16.8" cy="9.4" r="2.8"/><rect x="6" y="9.4" width="13.6" height="4.6" rx="2.3"/></g><line x1="8.5" y1="16.6" x2="7" y2="20.4"/><line x1="12.5" y1="16.6" x2="11" y2="20.4"/><line x1="16.5" y1="16.6" x2="15" y2="20.4"/></svg>`,

  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><g fill="currentColor" stroke="none"><circle cx="8" cy="9.4" r="3"/><circle cx="12.6" cy="6.8" r="3.9"/><circle cx="16.8" cy="9.4" r="2.8"/><rect x="6" y="9.4" width="13.6" height="4.6" rx="2.3"/></g><g stroke-width="1.4"><line x1="8" y1="16.5" x2="8" y2="20.5"/><line x1="6.3" y1="17.5" x2="9.7" y2="19.5"/><line x1="9.7" y1="17.5" x2="6.3" y2="19.5"/></g><g stroke-width="1.4"><line x1="16" y1="16.5" x2="16" y2="20.5"/><line x1="14.3" y1="17.5" x2="17.7" y2="19.5"/><line x1="17.7" y1="17.5" x2="14.3" y2="19.5"/></g></svg>`,

  thunder: `<svg viewBox="0 0 24 24" stroke="none"><g fill="currentColor"><circle cx="8" cy="8.4" r="3"/><circle cx="12.6" cy="5.8" r="3.9"/><circle cx="16.8" cy="8.4" r="2.8"/><rect x="6" y="8.4" width="13.6" height="4.6" rx="2.3"/><polygon points="13.5,14.5 9.5,19.5 12,19.5 10.5,23 15.5,17 12.8,17"/></g></svg>`,

  droplet: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c3 4 6 8.2 6 11.7a6 6 0 1 1-12 0c0-3.5 3-7.7 6-11.7z"/></svg>`,
};

function getWeatherIcon(code, isDay) {
  if (code === 0 || code === 1) return isDay ? ICONS.sun : ICONS.moon;
  if (code === 2) return isDay ? ICONS.cloudSun : ICONS.cloudMoon;
  if (code === 3) return ICONS.cloud;
  if (code === 45 || code === 48) return ICONS.fog;
  if ([51, 53, 55, 56, 57].includes(code)) return ICONS.drizzle;
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ICONS.rain;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ICONS.snow;
  if ([95, 96, 99].includes(code)) return ICONS.thunder;
  return ICONS.cloud; // sensible default for any code not listed above
}


/* ---------- 4. API calls ---------- */

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`${FORECAST_API}?${params.toString()}`);
  if (!res.ok) throw new Error('Weather service unavailable');
  return res.json();
}

async function searchPlaces(query) {
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' });
  const res = await fetch(`${GEOCODING_API}?${params.toString()}`);
  if (!res.ok) throw new Error('Search unavailable');
  const data = await res.json();
  return data.results || [];
}

async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), localityLanguage: 'en' });
  const res = await fetch(`${REVERSE_GEOCODE_API}?${params.toString()}`);
  if (!res.ok) throw new Error('Reverse geocoding unavailable');
  return res.json();
}


/* ---------- 5. Theme switching ---------- */

function themeKeyFor(weatherCode, isDay) {
  const entry = WMO_CODES[weatherCode] || WMO_CODES[3];
  return `${entry.group}-${isDay ? 'day' : 'night'}`;
}

function applyTheme(weatherCode, isDay) {
  const key = themeKeyFor(weatherCode, isDay);
  document.body.dataset.sky = key;
  document.body.dataset.glass = DARK_GLASS_THEMES.has(key) ? 'dark' : 'light';

  const group = (WMO_CODES[weatherCode] || WMO_CODES[3]).group;
  sceneController.setPrecipitation(group === 'rain' ? 'rain' : group === 'thunder' ? 'rain' : group === 'snow' ? 'snow' : 'none');
  sceneController.setThunder(group === 'thunder');
}


/* ---------- 6. Rendering: current conditions + 7-day forecast ---------- */

function formatPlaceName(place, subtitleOnly = false) {
  const bits = subtitleOnly ? [] : [place.name];
  if (place.admin1 && place.admin1 !== place.name) bits.push(place.admin1);
  if (place.country) bits.push(place.country);
  return bits.join(', ');
}

function renderCurrent(place, weather) {
  const cur = weather.current;
  const entry = WMO_CODES[cur.weather_code] || WMO_CODES[3];
  const uvToday = weather.daily?.uv_index_max?.[0];

  $('condition-text').textContent = entry.desc;
  $('location-text').textContent = formatPlaceName(place) || 'Your location';
  $('temp-value').textContent = Math.round(cur.temperature_2m);
  $('feels-like').textContent = `${Math.round(cur.apparent_temperature)}°`;
  $('humidity').textContent = `${Math.round(cur.relative_humidity_2m)}%`;
  $('wind').textContent = `${Math.round(cur.wind_speed_10m)} km/h`;
  $('uv-index').textContent = uvToday != null ? Math.round(uvToday) : '--';

  applyTheme(cur.weather_code, cur.is_day === 1);
}

function renderForecast(daily) {
  const list = $('forecast-list');
  list.innerHTML = '';

  daily.time.forEach((dateStr, i) => {
    const code = daily.weather_code[i];
    const entry = WMO_CODES[code] || WMO_CODES[3];
    const dayLabel = i === 0
      ? 'Today'
      : new Date(`${dateStr}T00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    const high = Math.round(daily.temperature_2m_max[i]);
    const low = Math.round(daily.temperature_2m_min[i]);
    const rainChance = Math.round(daily.precipitation_probability_max?.[i] ?? 0);

    const li = document.createElement('li');
    li.className = 'forecast-card';
    li.style.setProperty('--i', String(i));
    li.tabIndex = 0;
    li.setAttribute('role', 'group');
    li.setAttribute('aria-label', `${dayLabel}: ${entry.desc}, high ${high}°, low ${low}°, ${rainChance}% chance of rain`);
    li.innerHTML = `
      <p class="forecast-card__day">${dayLabel}</p>
      <div class="forecast-card__icon" aria-hidden="true">${getWeatherIcon(code, true)}</div>
      <p class="forecast-card__desc">${entry.desc}</p>
      <p class="forecast-card__temps">${high}°<span class="forecast-card__low">${low}°</span></p>
      <p class="forecast-card__rain" aria-hidden="true">${ICONS.droplet}${rainChance}%</p>
    `;
    list.appendChild(li);
  });

  revealForecast();
}


/* ---------- 7. Location search (debounced autocomplete combobox) ---------- */

const searchInput = $('search-input');
const searchList = $('search-list');
let searchDebounceTimer = null;
let activeOptionIndex = -1;
let currentResults = [];

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  clearTimeout(searchDebounceTimer);
  if (query.length < 2) {
    closeSearchList();
    return;
  }
  // Open-Meteo's geocoder does exact matching on 2 characters and fuzzy
  // matching from 3 onward, so waiting for 2 keeps results meaningful.
  searchDebounceTimer = setTimeout(() => runSearch(query), 350);
});

searchInput.addEventListener('keydown', (e) => {
  const options = Array.from(searchList.querySelectorAll('.search__option'));
  if (searchList.hidden || options.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeOptionIndex = (activeOptionIndex + 1) % options.length;
    highlightOption(options);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeOptionIndex = (activeOptionIndex - 1 + options.length) % options.length;
    highlightOption(options);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (activeOptionIndex >= 0 && currentResults[activeOptionIndex]) {
      selectPlace(currentResults[activeOptionIndex]);
    }
  } else if (e.key === 'Escape') {
    closeSearchList();
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) closeSearchList();
});

async function runSearch(query) {
  try {
    currentResults = await searchPlaces(query);
  } catch {
    currentResults = [];
  }
  renderSearchList(currentResults);
}

function renderSearchList(results) {
  activeOptionIndex = -1;
  searchList.innerHTML = '';

  if (results.length === 0) {
    const li = document.createElement('li');
    li.className = 'search__empty';
    li.textContent = 'No matching places found';
    searchList.appendChild(li);
  } else {
    results.forEach((place, i) => {
      const li = document.createElement('li');
      li.className = 'search__option';
      li.id = `search-option-${i}`;
      li.setAttribute('role', 'option');
      li.innerHTML = `<strong>${escapeHTML(place.name)}</strong><span>${escapeHTML(formatPlaceName(place, true))}</span>`;
      li.addEventListener('click', () => selectPlace(place));
      searchList.appendChild(li);
    });
  }

  openSearchList();
}

function highlightOption(options) {
  options.forEach((opt, i) => opt.classList.toggle('is-active', i === activeOptionIndex));
  options[activeOptionIndex]?.scrollIntoView({ block: 'nearest' });
}

function openSearchList() {
  searchList.hidden = false;
  searchInput.setAttribute('aria-expanded', 'true');
}

function closeSearchList() {
  searchList.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
  activeOptionIndex = -1;
}

// Selecting a suggestion is the ONLY way to change location — free text
// typed but never picked from the list is never submitted, so the app
// always shows a real, geocoded place.
async function selectPlace(place) {
  closeSearchList();
  searchInput.value = formatPlaceName(place);
  searchInput.blur();
  await loadWeatherFor(place);
}


/* ---------- 8. Geolocation bootstrap (with graceful fallback) ---------- */

function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function bootstrapLocation() {
  try {
    const coords = await getBrowserLocation();
    let place;
    try {
      const geo = await reverseGeocode(coords.latitude, coords.longitude);
      place = {
        name: geo.city || geo.locality || 'Your location',
        admin1: geo.principalSubdivision || '',
        country: geo.countryName || '',
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
    } catch {
      // Coordinates are fine, only the name lookup failed — still useful.
      place = { name: 'Your location', admin1: '', country: '', latitude: coords.latitude, longitude: coords.longitude };
    }
    await loadWeatherFor(place);
  } catch {
    // Permission denied, unsupported, or timed out.
    await loadWeatherFor(FALLBACK_LOCATION);
  }
}

async function loadWeatherFor(place) {
  $('location-text').textContent = formatPlaceName(place) || 'Your location';
  $('condition-text').textContent = 'Checking the sky…';
  setStatus('');
  try {
    const weather = await fetchForecast(place.latitude, place.longitude);
    renderCurrent(place, weather);
    renderForecast(weather.daily);
  } catch {
    $('condition-text').textContent = 'Weather unavailable';
    setStatus("Couldn't load weather for this location — check your connection and try again.");
  }
}


/* ---------- 9. Living sky: canvas rain/snow, star field, lightning ---------- */

let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = $('precip-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let precipMode = 'none'; // 'none' | 'rain' | 'snow'
let animationFrameId = null;
let thunderInterval = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 150);
});
resizeCanvas();

function spawnParticle() {
  if (precipMode === 'rain') {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      len: 10 + Math.random() * 14,
      speed: 7 + Math.random() * 6,
      drift: 2,
    };
  }
  return { // snow
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: 1.5 + Math.random() * 2.2,
    speed: 0.6 + Math.random() * 1.2,
    drift: (Math.random() - 0.5) * 0.6,
    sway: Math.random() * Math.PI * 2,
  };
}

function seedParticles() {
  const count = precipMode === 'snow' ? 90 : precipMode === 'rain' ? 140 : 0;
  particles = Array.from({ length: count }, spawnParticle);
}

function drawParticlesOnce() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (precipMode === 'rain') {
    ctx.strokeStyle = 'rgba(220, 235, 250, 0.55)';
    ctx.lineWidth = 1.4;
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.drift * 2, p.y + p.len);
      ctx.stroke();
    });
  } else if (precipMode === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function drawFrame() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (precipMode === 'rain') {
    ctx.strokeStyle = 'rgba(220, 235, 250, 0.55)';
    ctx.lineWidth = 1.4;
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.drift * 2, p.y + p.len);
      ctx.stroke();
      p.x += p.drift;
      p.y += p.speed;
      if (p.y > canvas.height) { p.y = -p.len; p.x = Math.random() * canvas.width; }
    });
  } else if (precipMode === 'snow') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      p.sway += 0.01;
      p.x += p.drift + Math.sin(p.sway) * 0.4;
      p.y += p.speed;
      if (p.y > canvas.height) { p.y = -p.r; p.x = Math.random() * canvas.width; }
    });
  }

  animationFrameId = requestAnimationFrame(drawFrame);
}

function startLoop() {
  if (animationFrameId || !ctx) return;
  drawFrame();
}
function stopLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function triggerFlash() {
  const flash = $('sky-flash');
  const pulse = () => {
    flash.classList.add('is-flashing');
    setTimeout(() => flash.classList.remove('is-flashing'), 100);
  };
  pulse();
  if (Math.random() > 0.5) setTimeout(pulse, 220); // the odd double-flash, like real lightning
}

const sceneController = {
  setPrecipitation(mode) {
    if (mode === precipMode) return;
    precipMode = mode;
    seedParticles();
    stopLoop();
    if (mode === 'none') {
      ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (reducedMotion) {
      drawParticlesOnce();
    } else {
      startLoop();
    }
  },
  setThunder(isActive) {
    clearInterval(thunderInterval);
    thunderInterval = null;
    if (isActive && !reducedMotion) {
      thunderInterval = setInterval(triggerFlash, 4000 + Math.random() * 5000);
    }
  },
};

// If the OS-level setting changes mid-session, follow it immediately.
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
  reducedMotion = e.matches;
  document.body.dataset.motion = reducedMotion ? 'reduced' : 'on';
  if (reducedMotion) {
    stopLoop();
    drawParticlesOnce();
    clearInterval(thunderInterval);
  } else if (precipMode !== 'none') {
    startLoop();
  }
});

function generateStars(count = 60) {
  const container = $('sky-stars');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 70}%`; // keep stars out of the lower, horizon half
    star.style.animationDelay = `${Math.random() * 3.5}s`;
    star.style.opacity = String(0.3 + Math.random() * 0.7);
    frag.appendChild(star);
  }
  container.appendChild(frag);
}


/* ---------- 10. Scroll reveal ---------- */

function revealForecast() {
  const list = $('forecast-list');
  list.classList.remove('is-visible');
  void list.offsetWidth; // force a reflow so the animation can restart
  requestAnimationFrame(() => list.classList.add('is-visible'));
}

// Handles the natural, first-ever scroll into view (e.g. on a short
// mobile screen where the forecast starts below the fold). Later
// re-renders (a new search) call revealForecast() directly instead.
const forecastObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      revealForecast();
      forecastObserver.disconnect();
    }
  });
}, { threshold: 0.2 });


/* ---------- 11. Init ---------- */

function init() {
  document.body.dataset.motion = reducedMotion ? 'reduced' : 'on';
  generateStars();
  forecastObserver.observe($('forecast-list'));
  bootstrapLocation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
