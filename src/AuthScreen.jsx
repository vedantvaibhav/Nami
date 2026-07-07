import { useState } from 'react'
import { supabase } from './supabase.js'

// Email + password sign in / sign up. No props — App reacts to the auth state
// change on success and swaps this screen out.
export default function AuthScreen() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setInfo('')
    const { data, error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    // signup with email-confirmation on returns no session — tell the user
    else if (mode === 'signup' && !data.session) setInfo('Check your email to confirm your account, then sign in.')
    // otherwise App's onAuthStateChange takes over and unmounts this screen
    setBusy(false)
  }

  const toggle = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
    setError(''); setInfo('')
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-title">Moments</div>
        <div className="auth-sub">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</div>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
        />
        <button className="auth-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}
        <button type="button" className="auth-toggle" onClick={toggle}>
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
