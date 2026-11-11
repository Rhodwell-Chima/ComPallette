import { forwardRef, InputHTMLAttributes, ReactNode, useEffect } from 'react';
import { useFormField, InputVariant, InputSize } from './FormField';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  variant?: InputVariant;
  size?: InputSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  isSuccess?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    variant: propVariant,
    size: propSize,
    leftIcon,
    rightIcon,
    isSuccess,
    className = '',
    onFocus,
    onBlur,
    onChange,
    value,
    defaultValue,
    disabled: propDisabled,
    readOnly: propReadOnly,
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
  const readOnly = propReadOnly !== undefined ? propReadOnly : field?.readOnly;
  const required = propRequired !== undefined ? propRequired : field?.required;
  const hasError = !!field?.error;

  useEffect(() => {
    if (field) {
      const val = value !== undefined ? value : defaultValue;
      field.setHasValue(val !== undefined && val !== null && String(val).length > 0);
    }
  }, [value, defaultValue, field]);

  const heightMap = {
    sm: '34px',
    md: '40px',
    lg: '48px',
  };

  const paddingYMap = {
    sm: '0.35rem',
    md: '0.5rem',
    lg: '0.75rem',
  };

  const getBorderAndBg = () => {
    if (variant === 'filled') {
      return {
        background: 'var(--surface-muted)',
        border: '1px solid transparent',
        borderRadius: '7px',
      };
    }
    if (variant === 'underline') {
      return {
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${hasError ? 'var(--danger, #ef4444)' : 'var(--border)'}`,
        borderRadius: '0',
      };
    }
    return {
      background: 'var(--surface)',
      border: `1px solid ${hasError ? 'var(--danger, #ef4444)' : 'var(--border)'}`,
      borderRadius: '7px',
    };
  };

  const styling = getBorderAndBg();

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
      {leftIcon && (
        <span
          style={{
            position: 'absolute',
            left: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            color: 'var(--muted)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {leftIcon}
        </span>
      )}

      <input
        ref={ref}
        id={field?.id}
        name={field?.name || rest.name}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={hasError ? 'true' : undefined}
        aria-describedby={
          [field?.descriptionId, field?.errorId].filter(Boolean).join(' ') || undefined
        }
        value={value}
        defaultValue={defaultValue}
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
          field?.setHasValue(e.target.value.length > 0);
          onChange?.(e);
        }}
        style={{
          width: '100%',
          height: heightMap[size],
          paddingTop: paddingYMap[size],
          paddingBottom: paddingYMap[size],
          paddingLeft: leftIcon ? '2.4rem' : '0.85rem',
          paddingRight: rightIcon || isSuccess ? '2.4rem' : '0.85rem',
          color: 'var(--text)',
          fontSize: size === 'sm' ? '0.82rem' : size === 'lg' ? '1rem' : '0.88rem',
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'all 0.18s cubic-bezier(0.32, 0.72, 0, 1)',
          boxShadow: field?.isFocused && !hasError && variant !== 'underline'
            ? '0 0 0 2px color-mix(in srgb, var(--primary) 28%, transparent)'
            : 'none',
          ...styling,
          ...style,
        }}
        className={`form-input form-input--${variant} form-input--${size} ${className}`}
        {...rest}
      />

      {(rightIcon || isSuccess) && (
        <span
          style={{
            position: 'absolute',
            right: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            color: isSuccess ? 'var(--success, #10b981)' : 'var(--muted)',
            zIndex: 1,
          }}
        >
          {isSuccess ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            rightIcon
          )}
        </span>
      )}
    </div>
  );
});
