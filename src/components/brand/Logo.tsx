import Image from 'next/image';
import './logo.css';

export type LogoVariant = 'full' | 'mark' | 'responsive';

export type LogoProps = {
  className?: string;
  variant?: LogoVariant;
  priority?: boolean;
  label?: string;
};

export default function Logo({
  className = '',
  variant = 'full',
  priority = false,
  label = 'memokeeps',
}: LogoProps) {
  return (
    <span
      className={`memokeeps-logo memokeeps-logo--${variant} ${className}`.trim()}
      role="img"
      aria-label={label}
    >
      {variant !== 'mark' ? (
        <Image
          className="memokeeps-logo__full"
          src="/brand/memokeeps-logo.svg"
          width={960}
          height={280}
          alt=""
          aria-hidden="true"
          priority={priority}
          unoptimized
          draggable={false}
        />
      ) : null}
      {variant !== 'full' ? (
        <Image
          className="memokeeps-logo__mark"
          src="/brand/options/favicon-01-pinned-polaroid.svg"
          width={256}
          height={256}
          alt=""
          aria-hidden="true"
          priority={priority}
          unoptimized
          draggable={false}
        />
      ) : null}
    </span>
  );
}
