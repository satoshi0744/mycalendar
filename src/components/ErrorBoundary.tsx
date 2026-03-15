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
            <h1>{isAuthError ? 'セッションが切れました' : '問題が発生しました'}</h1>
            <p>
              {isAuthError 
                ? '一定時間が経過したため、自動的に接続が解除されました。' 
                : 'アプリの描画中に予期せぬエラーが起きました。'}
            </p>
            <p className="error-boundary-msg">{this.state.error?.message}</p>
            <p className="error-boundary-hint">
              {isAuthError
                ? '「再起動してログイン」を押すと、ログイン画面に戻ります。'
                : '「設定をリセット」を押すと、初期状態に戻して再起動します。予定データは消えません。'}
            </p>
            <button
              className="error-boundary-btn"
              onClick={() => {
                if (isAuthError) {
                  localStorage.removeItem('__mycal_token'); // トークンをクリアして確実にログインへ誘導
                } else {
                  localStorage.clear();
                }
                window.location.reload();
              }}
            >
              {isAuthError ? '再起動してログイン' : '設定をリセットして再起動'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
