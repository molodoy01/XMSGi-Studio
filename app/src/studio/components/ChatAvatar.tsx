import { useState } from 'react';

type ChatAvatarProps = {
  name: string;
  src?: string;
  className: string;
  as?: 'div' | 'span';
};

export function ChatAvatar({ name, src, className, as = 'span' }: ChatAvatarProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const AvatarElement = as;
  const initial = name.trim().slice(0, 1).toUpperCase() || '?';

  return (
    <AvatarElement className={className} aria-hidden="true">
      {src && failedSource !== src ? (
        <img src={src} alt="" onError={() => setFailedSource(src)} />
      ) : initial}
    </AvatarElement>
  );
}