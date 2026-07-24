'use client';

/** Live-call audio waveform indicator — ports demo2.0's WaveAnim, recolored to brand red. */
export function WaveformViz({ active, className = '' }: { active: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-[3px] h-5 ${className}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={active ? 'wave-bar' : ''}
          style={{
            width: 2.5,
            height: '100%',
            background: active ? '#F87171' : '#E31E24',
            borderRadius: 2,
            animationDelay: `${i * 0.12}s`,
            opacity: active ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
