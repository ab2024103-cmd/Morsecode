import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Removes the default padding (tables, queues, logs manage their own). */
  flush?: boolean;
  className?: string;
}

export function Panel({ title, actions, children, flush, className = '' }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-h">
          {title && <h2 className="panel-title">{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="panel-b">{children}</div>}
    </section>
  );
}

export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {body && <p>{body}</p>}
      {children}
    </div>
  );
}
