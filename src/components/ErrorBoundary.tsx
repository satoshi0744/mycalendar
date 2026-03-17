import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import './ErrorBoundary.css';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      const isAuthError = this.state.error?.message?.includes('authenticated') || 
                          this.state.error?.message?.includes('token');

      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">{isAuthError ? '🔑' : '⚠️'}</div>
            <h1>{isAuthError ? 'カレンダーを同期するために' : '表示に時間がかかっています'}</h1>
            <p>
              {isAuthError 
                ? '一度ログアウトして、もう一度ログインをお願いします。' 
                : 'カレンダーの読み込み中に少しお休みが必要になったようです。'}
            </p>
            <p className="error-boundary-msg">{this.state.error?.message}</p>
            <p className="error-boundary-hint">
              {isAuthError
                ? '「もう一度ログイン」を押すと、ログイン画面に戻ります。'
                : '「リセットして再起動」を押すと、初期状態に戻ってアプリを再起動します。予定データは消えませんのでご安心ください。'}
            </p>
            <button
              className="error-boundary-btn"
              onClick={() => {
                if (isAuthError) {
                  localStorage.removeItem('__mycal_token');
                } else {
                  localStorage.clear();
                }
                window.location.reload();
              }}
            >
              {isAuthError ? 'もう一度ログイン' : 'リセットして再起動'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
