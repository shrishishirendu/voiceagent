'use client';

import { type HTMLAttributes } from 'react';

export function Card({ className = '', hoverLift = false, children, ...rest }: HTMLAttributes<HTMLDivElement> & { hoverLift?: boolean }) {
  return (
    <div className={`card ${hoverLift ? 'row-card' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 pt-3.5 pb-2.5 ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-4 pb-3.5 ${className}`} {...rest}>
      {children}
    </div>
  );
}
