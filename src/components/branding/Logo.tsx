'use client';

import React from 'react';
import Image from 'next/image';

interface LogoProps {
  variant?: 'full' | 'icon' | 'text';
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ variant = 'full', className = '' }) => {
  if (variant === 'icon') {
    return (
      <div className={`relative w-8 h-8 ${className}`}>
        <Image
          src="/t4n-logo.png"
          alt="T4N"
          width={32}
          height={32}
          className="object-contain"
        />
      </div>
    );
  }

  if (variant === 'text') {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <span className="text-2xl font-bold bg-gradient-to-r from-t4n-orange-500 to-t4n-orange-600 bg-clip-text text-transparent">
          T4N
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">alpha</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative w-8 h-8">
        <Image
          src="/t4n-logo.png"
          alt="T4N"
          width={32}
          height={32}
          className="object-contain"
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xl font-bold gradient-text">T4N</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">AI Engineering</span>
      </div>
    </div>
  );
};