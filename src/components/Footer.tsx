'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer style={{ 
      borderTop: '1px solid #2a2a35', 
      padding: '16px 24px', 
      fontSize: '12px', 
      color: '#9ca3af', 
      background: '#0f0f11',
      textAlign: 'center'
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'center', gap: '32px' }}>
        <Link 
          href="/terms" 
          style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#f97316')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
        >
          Terms
        </Link>
        <Link 
          href="/privacy" 
          style={{ color: '#9ca3af', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#f97316')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
        >
          Privacy
        </Link>
        <span>© {new Date().getFullYear()} T4N LTD</span>
      </div>
    </footer>
  );
}