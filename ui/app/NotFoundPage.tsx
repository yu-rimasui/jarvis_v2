import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="placeholder-page" aria-labelledby="not-found-title">
      <div className="placeholder-panel">
        <p className="page-eyebrow">404 / UNKNOWN SECTOR</p>
        <h1 id="not-found-title">ページが見つかりません</h1>
        <p>URLを確認するか、ダッシュボードへ戻ってください。</p>
        <Link className="primary-link" to="/">
          ダッシュボードへ戻る
        </Link>
      </div>
    </section>
  );
}
