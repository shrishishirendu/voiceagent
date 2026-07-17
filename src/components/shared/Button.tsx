'use client';

import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  icon?: React.ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, icon, disabled, className = '', children, ...rest },
  ref
) {
  return (
    <button ref={ref} className={`${VARIANT_CLASS[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
});
