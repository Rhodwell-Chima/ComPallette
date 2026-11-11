import { forwardRef, SelectHTMLAttributes } from 'react';
import { useFormField, InputVariant, InputSize } from './FormField';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  variant?: InputVariant;
  size?: InputSize;
  options?: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    variant: propVariant,
    size: propSize,
    options,
    children,
    className = '',
    onFocus,
    onBlur,
    onChange,
    disabled: propDisabled,
    required: propRequired,
    style,
    ...rest
  },
  ref
) {
  const field = useFormField();

  const variant = propVariant || field?.variant || 'default';
  const size = propSize || field?.size || 'md';
  const disabled = propDisabled !== undefined ? propDisabled : field?.disabled;
  const required = propRequired !== undefined ? propRequired : field?.required;
  const hasError = !!field?.error;

  const heightMap = {
    sm: '34px',
    md: '40px',
    lg: '48px',
  };

  const getBorderAndBg = () => {
    if (variant === 'filled') {
      return {
        background: 'var(--color-surface-hover, rgba(255, 255, 255, 0.05))',
        border: '1px solid transparent',
        borderRadius: '6px',
      };
    }
    if (variant === 'underline') {
      return {
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${hasError ? 'var(--color-error, #ef4444)' : 'var(--color-border, rgba(255, 255, 255, 0.15))'}`,
        borderRadius: '0',
      };
    }
    return {
      background: 'var(--color-surface, rgba(15, 23, 42, 0.6))',
      border: `1px solid ${hasError ? 'var(--color-error, #ef4444)' : 'var(--color-border, rgba(255, 255, 255, 0.15))'}`,
      borderRadius: '6px',
    };
  };

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
      <select
        ref={ref}
        id={field?.id}
        name={field?.name || rest.name}
        disabled={disabled}
        required={required}
        aria-invalid={hasError ? 'true' : undefined}
        aria-describedby={
          [field?.descriptionId, field?.errorId].filter(Boolean).join(' ') || undefined
        }
        onFocus={(e) => {
          field?.setIsFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          field?.setIsFocused(false);
          field?.setTouched(true);
          onBlur?.(e);
        }}
        onChange={(e) => {
          field?.setHasValue(!!e.target.value);
          onChange?.(e);
        }}
        style={{
          width: '100%',
          height: heightMap[size],
          paddingLeft: '0.85rem',
          paddingRight: '2.4rem',
          color: 'var(--color-text, #f8fafc)',
          fontSize: size === 'sm' ? '0.82rem' : size === 'lg' ? '1rem' : '0.9rem',
          fontFamily: 'inherit',
          outline: 'none',
          appearance: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          boxShadow: field?.isFocused && !hasError && variant !== 'underline'
            ? '0 0 0 2px var(--color-accent-dim, rgba(59, 130, 246, 0.3))'
            : 'none',
          ...getBorderAndBg(),
          ...style,
        }}
        className={`form-select form-select--${variant} form-select--${size} ${className}`}
        {...rest}
      >
        {options
          ? options.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                disabled={opt.disabled}
                style={{ background: '#0f172a', color: '#f8fafc' }}
              >
                {opt.label}
              </option>
            ))
          : children}
      </select>

      <span
        style={{
          position: 'absolute',
          right: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
          color: 'var(--color-text-muted, #94a3b8)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
    </div>
  );
});
