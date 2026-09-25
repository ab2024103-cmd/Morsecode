interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, title, description, disabled }: ToggleProps) {
  return (
    <div
      className="toggle"
      onClick={() => !disabled && onChange(!checked)}
      role="presentation"
      style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
    >
      <div className="toggle-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onChange(!checked);
        }}
      />
    </div>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

export function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <button
      type="button"
      className="checkbox"
      data-checked={checked}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{ background: 'transparent', border: 0, padding: 0, textAlign: 'left' }}
    >
      <i>✓</i>
      {label}
    </button>
  );
}
