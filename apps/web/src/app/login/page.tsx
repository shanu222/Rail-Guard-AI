'use client';
import { ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { DEMO_MODE, ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(DEMO_MODE);
  useEffect(() => {
    // badge follows the data: shown only while demo-flagged records exist
    api<{ demoMode: boolean }>('/v1/config')
      .then((c) => setDemo(c.demoMode))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/overview');
  }, [loading, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password, needTotp ? totp : undefined);
      router.replace('/overview');
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === 'TOTP_REQUIRED') setNeedTotp(true);
      else setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy">
      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-white">
            <ShieldAlert className="mb-2 h-10 w-10 text-accent" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">RAILGUARD AI</h1>
            <p className="text-sm text-slate-300">Track health &amp; crossing safety dashboard</p>
            {demo && (
              <span className="mt-3 rounded bg-accent px-2 py-0.5 text-xs font-bold">
                DEMO DATA
              </span>
            )}
          </div>
          <form
            onSubmit={submit}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-xl"
            aria-label="Sign in"
          >
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {needTotp && (
              <Field label="Authentication code" hint="6-digit code from your authenticator app">
                <Input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoFocus
                  required
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                />
              </Field>
            )}
            {error && (
              <p role="alert" className="rounded-lg bg-risk-5/10 px-3 py-2 text-sm text-risk-5">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </main>
      <footer className="py-4 text-center text-xs text-slate-400">
        Resilience Technologies Labs (SMC-Private) Limited · Islamabad
      </footer>
    </div>
  );
}
