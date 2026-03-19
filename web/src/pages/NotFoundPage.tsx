import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 56px)',
      gap: '1rem',
      color: '#64748b'
    }}>
      <span style={{ fontSize: '4rem' }}>🏁</span>
      <h1 style={{ color: '#e2e8f0' }}>404 - Page Not Found</h1>
      <Link to="/" style={{ color: '#f97316' }}>← Back to Live Map</Link>
    </div>
  )
}
