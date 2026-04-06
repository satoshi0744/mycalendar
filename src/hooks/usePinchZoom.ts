import { useState, useRef, useCallback } from 'react';

/**
 * ピンチイン・ピンチアウト操作でカレンダーの時間軸の高さ（ズーム率）を管理するカスタムフック
 */
export function usePinchZoom(initialHeight: number, minHeight: number = 40, maxHeight: number = 200) {
  const [hourHeight, setHourHeight] = useState(initialHeight);
  const initialDistRef = useRef<number | null>(null);
  const initialHeightRef = useRef<number>(initialHeight);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.stopPropagation();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialDistRef.current = dist;
      initialHeightRef.current = hourHeight;
    }
  }, [hourHeight]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialDistRef.current !== null) {
      e.stopPropagation();
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scale = dist / initialDistRef.current;
      const newHeight = Math.max(minHeight, Math.min(maxHeight, initialHeightRef.current * scale));
      setHourHeight(newHeight);
    }
  }, [minHeight, maxHeight]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      initialDistRef.current = null;
    }
  }, []);

  return { hourHeight, handleTouchStart, handleTouchMove, handleTouchEnd };
}
