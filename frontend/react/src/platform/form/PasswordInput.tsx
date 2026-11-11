import { forwardRef, useState } from 'react';
import { Input, InputProps } from './Input';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'rightIcon'> {
  showStrength?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { showStrength = false, onChange, value, ...rest },
  ref
) {
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState(0);

  const calculateStrength = (val: string) => {
    let score = 0;
    if (val.length >= 8) score += 25;
    if (/[A-Z]/.test(val)) score += 25;
    if (/[0-9]/.test(val)) score += 25;
    if (/[^A-Za-z0-9]/.test(val)) score += 25;
    return score;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (showStrength) {
      setStrength(calculateStrength(e.target.value));
    }
    onChange?.(e);
  };

  const eyeIcon = (
    <button
      type="button"
      onClick={() => setShowPassword(!showPassword)}
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      style={{
        background: 'none',
        border: 'none',
        padding: '2px',
        color: 'var(--color-text-muted, #94a3b8)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        outline: 'none',
      }}
    >
      {showPassword ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );

  const getStrengthColor = () => {
    if (strength <= 25) return '#ef4444';
    if (strength <= 50) return '#f59e0b';
    if (strength <= 75) return '#3b82f6';
    return '#10b981';
  };

  return (
    <div style={{ width: '100%' }}>
      <Input
        ref={ref}
        type={showPassword ? 'text' : 'password'}
        rightIcon={eyeIcon}
        onChange={handleChange}
        value={value}
        {...rest}
      />
      {showStrength && (
        <div style={{ marginTop: '0.4rem', width: '100%', display: 'flex', gap: '4px' }}>
          {[25, 50, 75, 100].map((threshold) => (
            <div
              key={threshold}
              style={{
                height: '3px',
                flex: 1,
                borderRadius: '2px',
                backgroundColor:
                  strength >= threshold ? getStrengthColor() : 'var(--color-border, rgba(255, 255, 255, 0.1))',
                transition: 'background-color 0.2s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});
