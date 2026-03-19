import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import type { Car } from '../lib/api'

// Fix leaflet default icon using locally bundled assets
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

function CarMarker({ car }: { car: Car }) {
  if (car.last_lat == null || car.last_lng == null) return null
  return (
    <Marker position={[car.last_lat, car.last_lng]}>
      <Popup>
        <strong>#{car.car_number}</strong> {car.team_name || car.display_name || ''}<br />
        Status: {car.status || 'Unknown'}<br />
        Mode: {car.sharing_mode || 'LIVE'}
      </Popup>
    </Marker>
  )
}

function FitBounds({ cars }: { cars: Car[] }) {
  const map = useMap()
  useEffect(() => {
    const positions = cars.filter(c => c.last_lat != null && c.last_lng != null)
      .map(c => [c.last_lat!, c.last_lng!] as [number, number])
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [50, 50], maxZoom: 14 })
    }
  }, [cars, map])
  return null
}

interface LiveMapProps {
  cars: Car[]
}

export default function LiveMap({ cars }: LiveMapProps) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {cars.map(car => <CarMarker key={car.id} car={car} />)}
      <FitBounds cars={cars} />
    </MapContainer>
  )
}
