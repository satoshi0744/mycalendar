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
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠️</div>
            <h1>問題が発生しました</h1>
            <p>アプリの描画中に予期せぬエラーが起きました。</p>
            <p className="error-boundary-msg">{this.state.error?.message}</p>
            <p className="error-boundary-hint">
              「設定をリセット」を押すと、端末に保存された設定やキャッシュをクリアし、正常な状態でアプリを再起動します。予定データが消えることはありません。
            </p>
            <button
              className="error-boundary-btn"
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
            >
              設定をリセットして再起動
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
