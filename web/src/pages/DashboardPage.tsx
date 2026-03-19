import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!user) navigate('/login')
  }, [user, navigate])

  if (!user) return null

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ color: '#f97316' }}>Dashboard</h1>
      <div style={{
        background: '#1a1a2e',
        borderRadius: '0.75rem',
        padding: '1.5rem',
        border: '1px solid #2d2d4e',
        marginBottom: '1rem'
      }}>
        <h2 style={{ margin: '0 0 1rem', color: '#e2e8f0' }}>Profile</h2>
        <p><strong>Email:</strong> {user.email}</p>
        <p><strong>Role:</strong> <span style={{ color: '#f97316' }}>{user.role}</span></p>
      </div>

      {user.role === 'PARTICIPANT' || user.role === 'ORGANIZER' || user.role === 'SUPERADMIN' ? (
        <div style={{
          background: '#1a1a2e',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          border: '1px solid #2d2d4e'
        }}>
          <h2 style={{ margin: '0 0 1rem', color: '#e2e8f0' }}>Quick Actions</h2>
          <p style={{ color: '#64748b' }}>
            {user.role === 'PARTICIPANT'
              ? 'You can send location pings and create posts from your car page.'
              : 'As an organizer, you can manage events, stages, and cars via the API.'}
          </p>
        </div>
      ) : (
        <div style={{
          background: '#1a1a2e',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          border: '1px solid #2d2d4e',
          color: '#64748b'
        }}>
          You're following the race as a fan. Follow cars to get notified of updates!
        </div>
      )}
    </div>
  )
}
