import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type Coordinates = { latitude: number; longitude: number }
type NominatimResult = { place_id: number; display_name: string; lat: string; lon: string }
type LocationPickerProps = { initialLatitude?: number | null; initialLongitude?: number | null; onChange: (latitude: number | undefined, longitude: number | undefined) => void }

const SRI_LANKA_BOUNDS: [[number, number], [number, number]] = [[5.5, 79.5], [10, 82]]
const SRI_LANKA_CENTER: [number, number] = [7.8731, 80.7718]
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const locationIcon = L.divIcon({ className: 'location-pin', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

function isSriLankanLocation(latitude: number, longitude: number) {
  return latitude >= 5.5 && latitude <= 10 && longitude >= 79.5 && longitude <= 82
}

function MapView({ position, onSelect }: { position: Coordinates | null; onSelect: (latitude: number, longitude: number) => void }) {
  const map = useMap()
  useEffect(() => { if (position) map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 14)) }, [map, position])
  useMapEvents({ click: (event) => onSelect(event.latlng.lat, event.latlng.lng) })
  return position ? <Marker icon={locationIcon} position={[position.latitude, position.longitude]} draggable eventHandlers={{ dragend: (event) => { const marker = event.target as L.Marker; const next = marker.getLatLng(); onSelect(next.lat, next.lng) } }}><Popup>Customer location</Popup></Marker> : null
}

export default function LocationPicker({ initialLatitude, initialLongitude, onChange }: LocationPickerProps) {
  const initialPosition = initialLatitude != null && initialLongitude != null && isSriLankanLocation(initialLatitude, initialLongitude) ? { latitude: initialLatitude, longitude: initialLongitude } : null
  const [position, setPosition] = useState<Coordinates | null>(initialPosition)
  const [search, setSearch] = useState(''); const [results, setResults] = useState<NominatimResult[]>([]); const [searching, setSearching] = useState(false); const [gpsLoading, setGpsLoading] = useState(false); const [gpsUnavailable, setGpsUnavailable] = useState(false); const [message, setMessage] = useState(''); const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => { const trimmed = search.trim(); const controller = new AbortController(); const timer = window.setTimeout(() => { if (trimmed.length < 3) { setResults([]); setSearching(false); return } setSearching(true); fetch(`${NOMINATIM_URL}?format=json&q=${encodeURIComponent(trimmed)}&countrycodes=lk&limit=5`, { signal: controller.signal, headers: { Accept: 'application/json', 'Accept-Language': 'en' } }).then((response) => { if (!response.ok) throw new Error('Search unavailable'); return response.json() as Promise<NominatimResult[]> }).then(setResults).catch((error: Error) => { if (error.name !== 'AbortError') setMessage('Address search is temporarily unavailable. You can place the pin directly on the map.') }).finally(() => setSearching(false)) }, 650); return () => { window.clearTimeout(timer); controller.abort() } }, [search])

  const commitLocation = (latitude: number, longitude: number) => { if (!isSriLankanLocation(latitude, longitude)) { setMessage('Choose a location within Sri Lanka.'); return } const next = { latitude: Number(latitude.toFixed(6)), longitude: Number(longitude.toFixed(6)) }; setPosition(next); setMessage(''); onChange(next.latitude, next.longitude) }
  const clearLocation = () => { setPosition(null); setMessage(''); onChange(undefined, undefined) }
  const useCurrentLocation = () => { if (!navigator.geolocation) { setGpsUnavailable(true); setMessage('This browser does not support location access. Place the pin on the map instead.'); return } setGpsLoading(true); setMessage(''); navigator.geolocation.getCurrentPosition((location) => { setGpsLoading(false); commitLocation(location.coords.latitude, location.coords.longitude) }, (error) => { setGpsLoading(false); if (error.code === error.PERMISSION_DENIED) setGpsUnavailable(true); setMessage(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Place the pin on the map instead.' : 'Could not get your location. Check GPS access or place the pin on the map.') }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }) }
  const selectSearchResult = (result: NominatimResult) => { commitLocation(Number(result.lat), Number(result.lon)); setSearch(result.display_name); setResults([]); setSearchOpen(false) }

  return <div className="location-picker"><div className="location-controls"><button className="secondary-button location-button" type="button" onClick={useCurrentLocation} disabled={gpsLoading || gpsUnavailable} title={gpsUnavailable ? 'Location access is unavailable or was denied' : undefined}>{gpsLoading ? 'Finding you...' : gpsUnavailable ? 'Location unavailable' : 'Use my current location'}<span aria-hidden="true">⌖</span></button><label className="location-search"><span>Search a Sri Lankan address</span><input value={search} onFocus={() => setSearchOpen(true)} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); setMessage('') }} placeholder="Search town, street, or landmark" /><small>{searching ? 'Searching...' : 'Powered by OpenStreetMap'}</small>{searchOpen && results.length > 0 && <div className="location-results">{results.map((result) => <button type="button" key={result.place_id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSearchResult(result)}>{result.display_name}</button>)}</div>}</label></div><div className="location-map"><MapContainer center={position ? [position.latitude, position.longitude] : SRI_LANKA_CENTER} zoom={position ? 14 : 8} maxBounds={SRI_LANKA_BOUNDS} minZoom={7} scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><MapView position={position} onSelect={commitLocation} /></MapContainer><div className="map-hint">Click the map or drag the pin to set the exact location.</div></div>{position && <div className="location-summary"><span>{position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}</span><button type="button" className="text-button" onClick={clearLocation}>Clear location</button></div>}{message && <p className="location-message" role="alert">{message}</p>}</div>
}

export function LocationMapPreview({ latitude, longitude }: Coordinates) {
  const position: [number, number] = [latitude, longitude]
  return <div className="location-preview"><MapContainer center={position} zoom={15} scrollWheelZoom={false} dragging={false} doubleClickZoom={false} zoomControl={false} touchZoom={false} keyboard={false}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><CircleMarker center={position} radius={8} pathOptions={{ color: '#0a0a0a', fillColor: '#0a0a0a', fillOpacity: 1 }} /></MapContainer></div>
}
