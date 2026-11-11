import { createContext, useContext, ReactNode, useState, useId } from 'react';

export type InputVariant = 'default' | 'filled' | 'underline';
export type InputSize = 'sm' | 'md' | 'lg';
export type ValidationTrigger = 'change' | 'blur' | 'submit';

export interface FormFieldContextValue {
  id: string;
  name?: string;
  variant: InputVariant;
  size: InputSize;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  error?: string;
  touched?: boolean;
  isFocused?: boolean;
  hasValue?: boolean;
  setTouched: (touched: boolean) => void;
  setIsFocused: (focused: boolean) => void;
  setHasValue: (hasValue: boolean) => void;
  descriptionId?: string;
  errorId?: string;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

export function useFormField() {
  return useContext(FormFieldContext);
}

export interface FormFieldProps {
  children: ReactNode;
  name?: string;
  label?: string;
  floatingLabel?: boolean;
  helperText?: string;
  error?: string;
  variant?: InputVariant;
  size?: InputSize;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  className?: string;
}

export function FormField({
  children,
  name,
  label,
  floatingLabel = false,
  helperText,
  error,
  variant = 'default',
  size = 'md',
  disabled = false,
  readOnly = false,
  required = false,
  className = '',
}: FormFieldProps) {
  const generatedId = useId();
  const id = name || generatedId;
  const descriptionId = `${id}-desc`;
  const errorId = `${id}-error`;

  const [touched, setTouched] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasValue, setHasValue] = useState(false);

  const contextValue: FormFieldContextValue = {
    id,
    name,
    variant,
    size,
    disabled,
    readOnly,
    required,
    error,
    touched,
    isFocused,
    hasValue,
    setTouched,
    setIsFocused,
    setHasValue,
    descriptionId: helperText ? descriptionId : undefined,
    errorId: error ? errorId : undefined,
  };

  const isFloated = isFocused || hasValue;

  return (
    <FormFieldContext.Provider value={contextValue}>
      <div
        className={`form-field form-field--${variant} form-field--${size} ${error ? 'has-error' : ''} ${disabled ? 'is-disabled' : ''} ${floatingLabel ? 'has-floating-label' : ''} ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          marginBottom: '0.85rem',
          width: '100%',
        }}
      >
        {label && !floatingLabel && (
          <label
            htmlFor={id}
            style={{
              fontSize: size === 'sm' ? '0.76rem' : size === 'lg' ? '0.90rem' : '0.82rem',
              fontWeight: 600,
              marginBottom: '0.35rem',
              color: error ? 'var(--danger, #ef4444)' : 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {label}
            {required && <span style={{ color: 'var(--danger, #ef4444)', fontSize: '0.85em' }}>*</span>}
          </label>
        )}

        <div style={{ position: 'relative', width: '100%' }}>
          {children}

          {label && floatingLabel && (
            <label
              htmlFor={id}
              style={{
                position: 'absolute',
                left: variant === 'underline' ? '0' : '0.85rem',
                top: isFloated ? '-0.55rem' : '50%',
                transform: isFloated ? 'none' : 'translateY(-50%)',
                fontSize: isFloated ? '0.72rem' : size === 'sm' ? '0.8rem' : '0.86rem',
                fontWeight: isFloated ? 700 : 500,
                color: error
                  ? 'var(--danger, #ef4444)'
                  : isFocused
                  ? 'var(--primary)'
                  : 'var(--muted)',
                background: isFloated && variant !== 'underline' ? 'var(--surface)' : 'transparent',
                padding: isFloated && variant !== 'underline' ? '0 4px' : '0',
                transition: 'all 0.18s cubic-bezier(0.32, 0.72, 0, 1)',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              {label}
              {required && <span style={{ color: 'var(--danger, #ef4444)', marginLeft: '2px' }}>*</span>}
            </label>
          )}
        </div>

        {error && (
          <span
            id={errorId}
            role="alert"
            style={{
              fontSize: '0.75rem',
              color: 'var(--danger, #ef4444)',
              marginTop: '0.3rem',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 500,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </span>
        )}

        {helperText && !error && (
          <span
            id={descriptionId}
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted)',
              marginTop: '0.3rem',
            }}
          >
            {helperText}
          </span>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
