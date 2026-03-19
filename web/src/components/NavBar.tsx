import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function NavBar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <nav style={{
      background: '#1a1a2e',
      padding: '0.75rem 1.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid #2d2d4e'
    }}>
      <Link to="/" style={{ color: '#f97316', fontWeight: 'bold', fontSize: '1.25rem', textDecoration: 'none' }}>
        🏎️ WackRaces
      </Link>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        {user ? (
          <>
            <Link to="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none' }}>Dashboard</Link>
            <span style={{ color: '#64748b', fontSize: '0.875rem' }}>{user.email}</span>
            <button onClick={handleLogout} style={{
              background: '#dc2626',
              color: 'white',
              border: 'none',
              padding: '0.375rem 0.75rem',
              borderRadius: '0.375rem',
              cursor: 'pointer'
            }}>Logout</button>
          </>
        ) : (
          <Link to="/login" style={{
            background: '#f97316',
            color: 'white',
            padding: '0.375rem 0.75rem',
            borderRadius: '0.375rem',
            textDecoration: 'none'
          }}>Login</Link>
        )}
      </div>
    </nav>
  )
}
