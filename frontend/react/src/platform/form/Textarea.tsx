import { forwardRef, TextareaHTMLAttributes, useEffect, useState } from 'react';
import { useFormField, InputVariant, InputSize } from './FormField';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  variant?: InputVariant;
  size?: InputSize;
  maxLength?: number;
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    variant: propVariant,
    size: propSize,
    maxLength,
    showCount = false,
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
    rows = 3,
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

  const [charCount, setCharCount] = useState<number>(() => {
    const init = value !== undefined ? value : defaultValue;
    return init ? String(init).length : 0;
  });

  useEffect(() => {
    if (value !== undefined) {
      setCharCount(String(value).length);
      field?.setHasValue(String(value).length > 0);
    }
  }, [value, field]);

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

  const getCountColor = () => {
    if (!maxLength) return 'var(--color-text-muted, #64748b)';
    const ratio = charCount / maxLength;
    if (ratio >= 1) return 'var(--color-error, #ef4444)';
    if (ratio >= 0.85) return 'var(--color-warning, #f59e0b)';
    return 'var(--color-text-muted, #64748b)';
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <textarea
        ref={ref}
        id={field?.id}
        name={field?.name || rest.name}
        rows={rows}
        maxLength={maxLength}
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
          setCharCount(e.target.value.length);
          field?.setHasValue(e.target.value.length > 0);
          onChange?.(e);
        }}
        style={{
          width: '100%',
          padding: size === 'sm' ? '0.4rem 0.6rem' : '0.65rem 0.85rem',
          color: 'var(--color-text, #f8fafc)',
          fontSize: size === 'sm' ? '0.82rem' : size === 'lg' ? '1rem' : '0.9rem',
          fontFamily: 'inherit',
          outline: 'none',
          resize: 'vertical',
          boxShadow: field?.isFocused && !hasError && variant !== 'underline'
            ? '0 0 0 2px var(--color-accent-dim, rgba(59, 130, 246, 0.3))'
            : 'none',
          ...getBorderAndBg(),
          ...style,
        }}
        className={`form-textarea form-textarea--${variant} form-textarea--${size} ${className}`}
        {...rest}
      />

      {(showCount || maxLength) && (
        <div
          style={{
            position: 'absolute',
            right: '0.6rem',
            bottom: '0.4rem',
            fontSize: '0.72rem',
            color: getCountColor(),
            pointerEvents: 'none',
            userSelect: 'none',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}
        >
          {charCount}
          {maxLength ? `/${maxLength}` : ''}
        </div>
      )}
    </div>
  );
});
