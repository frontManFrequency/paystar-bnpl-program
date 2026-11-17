'use client';
import Icon from './Icon';
export default function Logout() {
  return <button type="button" className="ps-btn ps-btn--secondary ps-btn--sm" onClick={async () => { await fetch('/api/v1/session', { method: 'DELETE' }); try { sessionStorage.clear(); } catch {} location.href = '/'; }}>
    <Icon name="logout" dir />خروج</button>;
}
