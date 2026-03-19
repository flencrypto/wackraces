import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  const handleInstall = async () => {
    await prompt.prompt()
    await prompt.userChoice
    setDismissed(true)
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: '1rem',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1a1a2e',
      border: '1px solid #f97316',
      borderRadius: '0.5rem',
      padding: '1rem 1.5rem',
      display: 'flex',
      gap: '1rem',
      alignItems: 'center',
      zIndex: 1000,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
    }}>
      <span style={{ color: '#e2e8f0' }}>📲 Install WackRaces app?</span>
      <button onClick={handleInstall} style={{
        background: '#f97316', color: 'white', border: 'none',
        padding: '0.375rem 0.75rem', borderRadius: '0.375rem', cursor: 'pointer'
      }}>Install</button>
      <button onClick={() => setDismissed(true)} style={{
        background: 'transparent', color: '#64748b', border: 'none', cursor: 'pointer'
      }}>✕</button>
    </div>
  )
}
