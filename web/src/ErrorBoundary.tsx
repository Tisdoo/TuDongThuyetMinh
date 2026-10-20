import { Component, type ReactNode } from 'react';

/** Lỗi không lường trước thì hiện nút tải lại thay vì màn hình trắng. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error(err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="step center">
        <h1 className="serif">Linh Ứng Guide</h1>
        <p className="muted">Ứng dụng gặp lỗi. Tải lại trang để tiếp tục. / Something went wrong. Reload to continue.</p>
        <button type="button" className="btn primary wide" onClick={() => window.location.reload()}>Tải lại / Reload</button>
      </div>
    );
  }
}
