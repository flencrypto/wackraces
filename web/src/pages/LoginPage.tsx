import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuthStore } from '../store/auth'

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('FAN')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const setAuth = useAuthStore(s => s.setAuth)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = mode === 'login'
        ? await authApi.login(email, password)
        : await authApi.register(email, password, role)
      setAuth(result.accessToken, result.refreshToken, result.user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem',
    background: '#0f0f1a',
    border: '1px solid #2d2d4e',
    borderRadius: '0.375rem',
    color: '#e2e8f0',
    fontSize: '1rem',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 'calc(100vh - 56px)',
      padding: '1rem'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: '#1a1a2e',
        borderRadius: '0.75rem',
        padding: '2rem',
        border: '1px solid #2d2d4e'
      }}>
        <h1 style={{ margin: '0 0 1.5rem', color: '#f97316', textAlign: 'center' }}>
          🏎️ {mode === 'login' ? 'Sign In' : 'Create Account'}
        </h1>

        <div style={{ display: 'flex', marginBottom: '1.5rem', gap: '0.5rem' }}>
          {(['login', 'register'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: 'none',
                borderRadius: '0.375rem',
                background: mode === m ? '#f97316' : '#2d2d4e',
                color: 'white',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
          {mode === 'register' && (
            <select value={role} onChange={e => setRole(e.target.value)} style={inputStyle}>
              <option value="FAN">Fan</option>
              <option value="PARTICIPANT">Participant</option>
              <option value="ORGANIZER">Organizer</option>
            </select>
          )}
          {error && <div style={{ color: '#ef4444', fontSize: '0.875rem' }}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '0.75rem',
              background: loading ? '#4b5563' : '#f97316',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '1rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold'
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
