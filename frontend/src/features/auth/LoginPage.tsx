import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '@/app/AuthContext';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Inputs';
import { useData } from '@/hooks/useData';
import { services } from '@/services';
import { ServiceError } from '@/services/types';
import { emailField, requiredText } from '@/utils/schemas';
import { titleCase } from '@/utils/format';

const schema = z.object({ email: emailField, password: requiredText('Password') });
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const demo = useData(() => services.auth.demoUsers());
  const [error, setError] = useState('');
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const { register, handleSubmit, setValue, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (user) return <Navigate to={from} replace />;

  const submit = handleSubmit(async (v) => {
    setError('');
    try {
      await login(v.email, v.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e instanceof ServiceError ? e.message : 'Could not sign in. Please try again.');
    }
  });

  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#181c27] via-[#0f121a] to-ink p-12 text-white lg:flex">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-white to-slate-200 text-base font-bold text-neutral-950 shadow-[0_6px_16px_-6px_rgba(255,255,255,0.45)]">R</div>
          <span className="text-lg font-semibold tracking-tight">RajuERP</span>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center py-8">
          <OperationsIllustration />
        </div>
        <div className="relative">
          <p className="max-w-md text-4xl font-semibold leading-[1.15] tracking-tight">
            Distribution.
            <br />
            Inventory.
            <br />
            Business Management.
          </p>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-neutral-400">
            RajuERP helps you manage inventory, distribution, sales, expenses and everyday business operations in one place.
          </p>
        </div>
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-7 flex items-center justify-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-950 text-lg font-bold text-white">R</div>
            <span className="text-xl font-semibold tracking-tight">RajuERP</span>
          </div>

          <div className="surface rounded-3xl p-7 shadow-pop sm:p-9">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-neutral-500 lg:hidden">Distribution, inventory and billing in one place.</p>

            <form onSubmit={submit} noValidate className="mt-6 space-y-4">
              {error && (
                <div role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
                  {error}
                </div>
              )}
              <Field label="Email" error={formState.errors.email?.message} required>
                <Input type="email" autoComplete="username" {...register('email')} />
              </Field>
              <Field label="Password" error={formState.errors.password?.message} required>
                <Input type="password" autoComplete="current-password" {...register('password')} />
              </Field>
              <Button type="submit" className="w-full" loading={formState.isSubmitting}>
                Sign in
              </Button>
            </form>
          </div>

          {(demo.data?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-2xl bg-amber-50/80 p-4 text-xs text-amber-900 ring-1 ring-amber-200/80 backdrop-blur">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" /> Demo mode
              </p>
              <p className="mt-1">This is a front-end prototype with simulated data. Sign-in is a mock and provides no real security. Any password works; choose a role to try its menu and permissions:</p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {demo.data?.slice(0, 4).map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setValue('email', u.email, { shouldValidate: true });
                      setValue('password', 'demo', { shouldValidate: true });
                    }}
                    className="rounded-xl bg-white px-3 py-2.5 text-left shadow-sm ring-1 ring-amber-200 transition-all hover:-translate-y-px hover:ring-amber-400"
                  >
                    <span className="block text-xs font-medium text-neutral-900">{titleCase(u.role)}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{u.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Line illustration for the left panel: a stocked warehouse rack, a delivery truck and a small report card. Monochrome, decorative only. */
function OperationsIllustration() {
  const line = 'rgba(255,255,255,0.5)';
  const soft = 'rgba(255,255,255,0.28)';
  const fill = 'rgba(255,255,255,0.08)';
  /** One stocked box: body, tape strip and a small label. */
  const box = (x: number, y: number, w: number, h: number, label = false) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={line} strokeWidth={1.5} />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h * 0.32} stroke={soft} strokeWidth={1.5} />
      {label && <rect x={x + 6} y={y + h - 13} width={Math.min(18, w - 12)} height={7} rx={1.5} fill="none" stroke={soft} strokeWidth={1.2} />}
    </g>
  );
  const shelves = [110, 190, 270];
  const stock: [number, number, number, number, boolean][][] = [
    [[60, 70, 44, 40, true], [112, 78, 36, 32, false], [156, 62, 48, 48, true], [212, 82, 34, 28, false]],
    [[58, 148, 56, 42, false], [122, 160, 40, 30, true], [170, 150, 36, 40, false], [214, 156, 32, 34, true]],
    [[60, 226, 50, 44, true], [118, 238, 38, 32, false], [164, 224, 48, 46, false], [220, 244, 28, 26, true]],
  ];
  return (
    <svg viewBox="0 0 480 320" role="img" aria-label="Warehouse shelves with stocked boxes, a delivery truck and a sales report card" className="h-auto w-full max-w-[26rem] 2xl:max-w-[34rem]">
      {/* floor */}
      <line x1={16} y1={300} x2={464} y2={300} stroke={soft} strokeWidth={1.5} />

      {/* rack */}
      <line x1={44} y1={40} x2={44} y2={300} stroke={line} strokeWidth={3} strokeLinecap="round" />
      <line x1={256} y1={40} x2={256} y2={300} stroke={line} strokeWidth={3} strokeLinecap="round" />
      {shelves.map((y) => (
        <line key={y} x1={44} y1={y} x2={256} y2={y} stroke={line} strokeWidth={3} strokeLinecap="round" />
      ))}
      {stock.map((row) => row.map(([x, y, w, h, l]) => box(x, y, w, h, l)))}

      {/* distribution: dashed route from the rack to the truck */}
      <path d="M262 150 H296" stroke={line} strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
      <path d="M296 150 l-6 -4 v8 z" fill={line} />

      {/* truck */}
      <rect x={302} y={116} width={92} height={58} rx={5} fill={fill} stroke={line} strokeWidth={1.5} />
      <path d="M394 134 h22 a6 6 0 0 1 5 3 l14 20 a6 6 0 0 1 1 3 V174 H394 Z" fill={fill} stroke={line} strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M402 142 h12 l11 15 h-23 Z" fill="none" stroke={soft} strokeWidth={1.2} strokeLinejoin="round" />
      <line x1={318} y1={132} x2={378} y2={132} stroke={soft} strokeWidth={1.2} />
      <line x1={318} y1={142} x2={362} y2={142} stroke={soft} strokeWidth={1.2} />
      {[326, 378, 424].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={178} r={11} fill="#0f121a" stroke={line} strokeWidth={1.8} />
          <circle cx={cx} cy={178} r={3.5} fill="none" stroke={soft} strokeWidth={1.2} />
        </g>
      ))}
      <line x1={290} y1={190} x2={452} y2={190} stroke={soft} strokeWidth={1.2} strokeDasharray="2 5" />

      {/* report card */}
      <rect x={316} y={30} width={134} height={66} rx={10} fill={fill} stroke={line} strokeWidth={1.5} />
      <line x1={330} y1={46} x2={366} y2={46} stroke={soft} strokeWidth={2} strokeLinecap="round" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={332 + i * 22} y={84 - [14, 24, 18, 32][i]} width={12} height={[14, 24, 18, 32][i]} rx={2.5} fill="rgba(255,255,255,0.55)" />
      ))}
      <path d="M338 70 L360 62 L382 66 L418 52" fill="none" stroke="rgba(96,165,250,0.9)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

      {/* pallet with stacked boxes */}
      <rect x={300} y={288} width={148} height={12} rx={2} fill="rgba(255,255,255,0.16)" stroke={line} strokeWidth={1.5} />
      {box(306, 244, 62, 44, true)}
      {box(374, 244, 68, 44, false)}
      {box(322, 202, 56, 42, false)}
      {box(386, 210, 46, 34, true)}
    </svg>
  );
}
