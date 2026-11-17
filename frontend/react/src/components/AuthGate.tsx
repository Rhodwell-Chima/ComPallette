import React, { FormEvent, createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getOperatorSession,
  initialiseCsrf,
  setAuthenticationFailureHandler,
  signInOperator,
  signOutOperator,
} from '../services/api';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'The ComPallette backend could not be reached. Check the service and try again.';
}

function canEnterOperations(session: Awaited<ReturnType<typeof getOperatorSession>>): boolean {
  return Boolean(session?.authenticated && (session.is_staff || session.capabilities?.includes('view')));
}

interface AuthContextValue {
  session: NonNullable<Awaited<ReturnType<typeof getOperatorSession>>>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useOperatorSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useOperatorSession must be used inside AuthGate.');
  return context;
}

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [session, setSession] = useState<NonNullable<Awaited<ReturnType<typeof getOperatorSession>>> | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const signInPending = useRef(false);

  useEffect(() => setAuthenticationFailureHandler(() => {
    setAuthenticated(false);
    setSession(null);
    setPassword('');
    setError('Your operator session ended or no longer has access. Sign in again.');
  }), []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        await initialiseCsrf();
        const session = await getOperatorSession();
        if (!active) return;

        setAuthenticated(canEnterOperations(session));
        setSession(canEnterOperations(session) ? session : null);
        if (session?.authenticated && !canEnterOperations(session)) {
          await signOutOperator().catch(() => undefined);
          if (active) setError('This account does not have operational site access. Ask an administrator to assign a site role.');
        }
      } catch (requestError) {
        if (active) setError(errorMessage(requestError));
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => { active = false; };
  }, []);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (signInPending.current) return;
    signInPending.current = true;
    setSigningIn(true);
    setError('');

    try {
      await initialiseCsrf();
      const session = await signInOperator(username, password);
      if (!canEnterOperations(session)) {
        await signOutOperator().catch(() => undefined);
        setError('This account does not have operational site access. Ask an administrator to assign a site role.');
        return;
      }
      setPassword('');
      setAuthenticated(true);
      setSession(session);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      signInPending.current = false;
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    // Leave the protected UI immediately. A slow or interrupted logout request
    // must never trap an operator in the cockpit.
    setAuthenticated(false);
    setSession(null);
    setPassword('');
    try {
      await signOutOperator();
    } catch {
      setError('You have left the operator interface. The server could not confirm session termination; refresh before using this browser again.');
    }
  };

  if (!ready) return <div className="auth-loading">Checking operator session…</div>;
  if (!authenticated) return (
    <main className="auth-screen"><form className="auth-card" onSubmit={signIn}>
      <h1>ComPallette Operations</h1><p>Sign in with your Django operator account.</p>
      <label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p role="alert" className="auth-error">{error}</p>}<button className="button primary" type="submit" disabled={signingIn} aria-busy={signingIn}>{signingIn ? 'Signing in…' : 'Sign in'}</button>
    </form></main>
  );
  if (!session) return null;
  return <AuthContext.Provider value={{ session, signOut }}>{children}</AuthContext.Provider>;
};
