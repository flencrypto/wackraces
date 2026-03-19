import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { eventsApi } from '../lib/api'
import LiveMap from '../components/LiveMap'
import EventFeed from '../components/EventFeed'

const DEMO_EVENT_ID = import.meta.env.VITE_DEFAULT_EVENT_ID || ''

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'map' | 'feed'>('map')

  const { data: cars = [], isLoading } = useQuery({
    queryKey: ['cars', DEMO_EVENT_ID],
    queryFn: () => eventsApi.getCars(DEMO_EVENT_ID),
    enabled: !!DEMO_EVENT_ID,
    refetchInterval: 15_000,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      <div style={{
        display: 'flex',
        background: '#1a1a2e',
        borderBottom: '1px solid #2d2d4e'
      }}>
        {(['map', 'feed'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '0.75rem',
              border: 'none',
              background: activeTab === tab ? '#2d2d4e' : 'transparent',
              color: activeTab === tab ? '#f97316' : '#94a3b8',
              cursor: 'pointer',
              fontWeight: activeTab === tab ? 'bold' : 'normal',
              textTransform: 'capitalize'
            }}
          >
            {tab === 'map' ? '🗺️ Live Map' : '📰 Feed'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'map' ? (
          <div style={{ height: '100%' }}>
            {!DEMO_EVENT_ID ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                flexDirection: 'column',
                gap: '1rem',
                color: '#64748b'
              }}>
                <span style={{ fontSize: '4rem' }}>🏎️</span>
                <h2>Wacky Races Live Tracker</h2>
                <p>No active event. Set VITE_DEFAULT_EVENT_ID to track a race.</p>
              </div>
            ) : isLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
                Loading map…
              </div>
            ) : (
              <LiveMap cars={cars} />
            )}
          </div>
        ) : (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            {DEMO_EVENT_ID ? (
              <EventFeed eventId={DEMO_EVENT_ID} />
            ) : (
              <div style={{ padding: '2rem', color: '#64748b', textAlign: 'center' }}>
                No active event configured.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
