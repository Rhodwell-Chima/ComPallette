import React, { FormEvent, useEffect, useState } from 'react';
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

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setAuthenticationFailureHandler(() => {
    setAuthenticated(false);
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

        setAuthenticated(Boolean(session?.authenticated && session.is_staff));
        if (session?.authenticated && !session.is_staff) {
          await signOutOperator().catch(() => undefined);
          if (active) setError('This account does not have operator access.');
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
    setError('');

    try {
      await initialiseCsrf();
      const session = await signInOperator(username, password);
      if (!session.is_staff) {
        await signOutOperator().catch(() => undefined);
        setError('This account does not have operator access.');
        return;
      }
      setPassword('');
      setAuthenticated(true);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  const signOut = async () => {
    try {
      await signOutOperator();
    } finally {
      setAuthenticated(false);
      setPassword('');
    }
  };

  if (!ready) return <div className="auth-loading">Checking operator session…</div>;
  if (!authenticated) return (
    <main className="auth-screen"><form className="auth-card" onSubmit={signIn}>
      <h1>ComPallette Operations</h1><p>Sign in with your Django operator account.</p>
      <label>Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p role="alert" className="auth-error">{error}</p>}<button type="submit">Sign in</button>
    </form></main>
  );
  return <>{children}<button className="auth-signout" onClick={() => void signOut()}>Sign out</button></>;
};
