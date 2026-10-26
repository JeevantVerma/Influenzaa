import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';

// ---- Icons (inline SVG, stroke-based) ----------------------------------------
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 17-4.35-4.35',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zm14 0-3 7a4 4 0 0 0 6 0zM8 21h8',
  check: 'M20 6 9 17l-5-5',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z M9 12l2 2 4-4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8.5 3a8.5 8.5 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2.2-1.3L15.5 2h-4l-.4 2.4a8 8 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a8.5 8.5 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a8 8 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8zm4 12a2 2 0 0 0 4 0',
  menu: 'M4 6h16M4 12h16M4 18h16',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h4v16H7zm6 0h4v16h-4z',
  stop: 'M6 6h12v12H6z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  sparkle: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  x: 'M6 6l12 12M18 6 6 18',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  briefcase: 'M4 7h16v13H4zM9 7V4h6v3M4 12h16',
  chevron: 'M9 6l6 6-6 6',
  rupee: 'M7 4h10M7 8h10M7 4c5 0 7 2 7 4s-2 4-7 4l8 8',
  invoice: 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
};

export function Icon({ name, size = 18, className = 'nav-icon', label }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      <path d={PATHS[name] || PATHS.sparkle} />
    </svg>
  );
}

// ---- Primitives ---------------------------------------------------------------
export function Button({ variant, size, loading, children, className = '', icon, ...rest }) {
  const cls = ['btn', variant, size, className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} className="" /> : null}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, footer, className = '', bodyClass = 'card-body', as: Tag = 'section' }) {
  return (
    <Tag className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="btn-group">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
      {footer && <div className="card-footer">{footer}</div>}
    </Tag>
  );
}

export function Badge({ tone = '', children, title }) {
  return (
    <span className={`badge ${tone}`} title={title}>
      {children}
    </span>
  );
}

export function DemoBadge({ show = true, label = 'Demo data' }) {
  if (!show) return null;
  return (
    <Badge tone="demo" title="Fictional demo data. Not a real brand, contact or message.">
      {label}
    </Badge>
  );
}

export function Field({ label, hint, error, children, id: given }) {
  const auto = useId();
  const id = given || auto;
  const child = typeof children === 'function' ? children({ id, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': hint || error ? `${id}-desc` : undefined }) : children;
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {child}
      {(error || hint) && (
        <span id={`${id}-desc`} className={error ? 'error' : 'hint'}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>
        <span className="strong">{label}</span>
        {description && <span className="muted small" style={{ display: 'block' }}>{description}</span>}
      </span>
    </label>
  );
}

/** Multi-select chip group (accessible toggle buttons). */
export function ChipSelect({ options, value = [], onChange, tone, max, label }) {
  const toggle = (v) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
  };
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
        return (
          <button key={v} type="button" className={`chip ${tone || ''}`} aria-pressed={value.includes(v)} onClick={() => toggle(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count ? <span className="badge warning" style={{ marginLeft: 6 }}>{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function LoadingCard({ lines = 4 }) {
  return (
    <div className="card card-body stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 12}%`} />
      ))}
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }} aria-busy="true">
      <span className="spinner" style={{ width: 28, height: 28, color: 'var(--primary)' }} />
    </div>
  );
}

export function EmptyState({ title, children, action, icon = 'sparkle' }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} className="" />
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: 460 }}>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="callout danger" role="alert">
      <Icon name="alert" className="" />
      <div className="grow">
        <div className="strong">Something went wrong</div>
        <div className="small">{error?.message || 'Unexpected error'}</div>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const el = ref.current;
    el?.querySelector('input, textarea, select, button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-head row between">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          <Button variant="ghost" size="sm" className="icon" aria-label="Close" onClick={onClose}>
            <Icon name="x" className="" size={16} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog for consequential actions. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger, loading, requireCheck }) {
  const checkRef = useRef(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger solid' : 'primary'}
            loading={loading}
            onClick={() => {
              if (requireCheck && !checkRef.current?.checked) {
                checkRef.current?.focus();
                return;
              }
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        {children}
        {requireCheck && (
          <label className="checkbox">
            <input type="checkbox" ref={checkRef} />
            <span>{requireCheck}</span>
          </label>
        )}
      </div>
    </Modal>
  );
}

export function MoneyInput({ value, onChange, id, placeholder, currency = 'INR', ...rest }) {
  const sym = currency === 'INR' ? '₹' : currency;
  return (
    <div className="input-prefix">
      <span aria-hidden="true">{sym}</span>
      <input id={id} className="input num" inputMode="decimal" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export function ScoreBadge({ score }) {
  const tone = score >= 65 ? 'high' : score >= 40 ? 'mid' : 'low';
  return (
    <span className={`score ${tone}`} title="Match score out of 100. It helps you prioritise; it doesn't predict a deal.">
      {score ?? '–'}
    </span>
  );
}

// ---- Page structure ---------------------------------------------------------------
/** Page title with an optional back link (shown on phones) and actions. */
export function PageHead({ title, subtitle, back, badges, actions }) {
  return (
    <header className="page-head">
      {back && <Link to={back.to} className="back-link"><Icon name="chevron" size={16} className="flip" /> {back.label}</Link>}
      <div className="page-head-row">
        <div className="grow">
          <div className="row wrap"><h1>{title}</h1>{badges}</div>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
        {actions && <div className="btn-group">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled block: heading row outside, content in a card. */
export function Section({ title, aside, children, className = '', bodyClass = 'card-body', id }) {
  return (
    <section className={`section ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || aside) && <div className="panel-title">{typeof title === 'string' ? <h2>{title}</h2> : title}{aside}</div>}
      <div className={`card ${bodyClass === 'card-body' ? '' : 'panel'}`}><div className={bodyClass}>{children}</div></div>
    </section>
  );
}

/** Folded-away details (native <details>, keyboard accessible). */
export function Disclosure({ title, meta, children, defaultOpen = false }) {
  return (
    <details className="disclosure" open={defaultOpen || undefined}>
      <summary>
        <span className="grow"><span className="strong">{title}</span>{meta && <span className="small muted"> · {meta}</span>}</span>
        <Icon name="chevron" size={16} className="disclosure-chevron" />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
