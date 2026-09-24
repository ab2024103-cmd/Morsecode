interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
  label?: string;
}

export function Slider({
  value,
  min = 1,
  max = 100,
  step = 1,
  onChange,
  format = (v) => `${v}%`,
  label,
}: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="slider-row">
        <input
          className="slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label ?? 'slider'}
          style={{ ['--fill' as string]: `${fill}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">{format(value)}</span>
      </div>
    </div>
  );
}
