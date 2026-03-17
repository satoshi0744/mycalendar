import React from 'react';
import './ReconnectButton.css';

interface ReconnectButtonProps {
  onReconnect: () => void;
  message?: string;
}

/**
 * MyCalendar - セッション再接続・リトライボタン
 * 
 * 認証エラーや通信エラーが発生した際に、
 * キャッシュを表示しつつ再ログインを促すためのUI。
 */
export const ReconnectButton: React.FC<ReconnectButtonProps> = ({ 
  onReconnect, 
  message = "セッションが切れました。再接続して最新データを取得しますか？" 
}) => {
  return (
    <div className="reconnect-container">
      <p className="reconnect-message">{message}</p>
      <button className="reconnect-button" onClick={onReconnect}>
        <span className="reconnect-icon">🔄</span> 再接続
      </button>
    </div>
  );
};
