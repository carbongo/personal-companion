/**
 * Weather context provider — Open-Meteo (free, no API key). Enabled when
 * WEATHER_LAT/WEATHER_LON are set. Cached for 10 minutes; any failure degrades
 * to null so the weather line is simply omitted, never breaking a turn.
 */
import { config } from "#/config/index.ts";

export interface Weather {
	location: string;
	current: { temp: number; code: number; wind: number };
	today: { tMin: number; tMax: number } | null;
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; value: Weather } | null = null;

/** Whether weather context is configured. */
export function weatherEnabled(): boolean {
	return config.weather.lat != null && config.weather.lon != null;
}

export async function getWeather(): Promise<Weather | null> {
	if (!weatherEnabled()) return null;
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

	const url =
		"https://api.open-meteo.com/v1/forecast" +
		`?latitude=${config.weather.lat}&longitude=${config.weather.lon}` +
		"&current=temperature_2m,weather_code,wind_speed_10m" +
		"&daily=temperature_2m_min,temperature_2m_max&timezone=auto";

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return null;
		const data = (await res.json()) as {
			current?: {
				temperature_2m?: number;
				weather_code?: number;
				wind_speed_10m?: number;
			};
			daily?: {
				temperature_2m_min?: number[];
				temperature_2m_max?: number[];
			};
		};
		const cur = data.current;
		if (!cur) return null;
		const value: Weather = {
			location: config.weather.locationName || "your area",
			current: {
				temp: Math.round(cur.temperature_2m ?? 0),
				code: cur.weather_code ?? 0,
				wind: Math.round(cur.wind_speed_10m ?? 0),
			},
			today:
				data.daily?.temperature_2m_min?.[0] != null &&
				data.daily?.temperature_2m_max?.[0] != null
					? {
							tMin: Math.round(data.daily.temperature_2m_min[0]),
							tMax: Math.round(data.daily.temperature_2m_max[0]),
						}
					: null,
		};
		cache = { at: Date.now(), value };
		return value;
	} catch {
		return null;
	}
}

/** WMO weather-code → short human description. */
export function weatherDescription(code: number): string {
	if (code === 0) return "clear";
	if (code === 1 || code === 2) return "partly cloudy";
	if (code === 3) return "overcast";
	if (code === 45 || code === 48) return "fog";
	if (code >= 51 && code <= 57) return "drizzle";
	if (code >= 61 && code <= 67) return "rain";
	if (code >= 71 && code <= 77) return "snow";
	if (code >= 80 && code <= 82) return "rain showers";
	if (code >= 85 && code <= 86) return "snow showers";
	if (code >= 95) return "thunderstorm";
	return "unsettled";
}
