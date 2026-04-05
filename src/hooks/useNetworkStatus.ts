import { useState, useEffect } from 'react';

/**
 * ブラウザのネットワーク接続状態をリアルタイムで監視するフック。
 * navigator.onLine と online/offline イベントを使用して、
 * 実際のインターネット接続有無を返す。
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
