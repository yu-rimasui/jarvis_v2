import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { label: "Overview", path: "/", end: true },
  { label: "R&D Intelligence", path: "/rd-intelligence", end: false },
  { label: "Chat", path: "/chat", end: false },
  { label: "Memory", path: "/memory", end: false },
  { label: "Tasks", path: "/tasks", end: false },
] as const;

export function AppShell() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        メインコンテンツへ移動
      </a>
      <aside className="app-sidebar" aria-label="メインナビゲーション">
        <NavLink className="brand-lockup" to="/" aria-label="Jarvis ホーム">
          <span className="brand-mark" aria-hidden="true">
            J
          </span>
          <span>
            <strong>JARVIS</strong>
            <small>LOCAL COMMAND</small>
          </span>
        </NavLink>

        <nav className="primary-navigation">
          <p className="navigation-label">WORKSPACE</p>
          {navigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `navigation-link${isActive ? " is-active" : ""}`
              }
            >
              <span className="navigation-dot" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-status" aria-label="ローカルシステム状態">
          <span className="status-orb" aria-hidden="true" />
          <span>
            <strong>Local system</strong>
            <small>External posting off</small>
          </span>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-header">
          <div>
            <p>PERSONAL INTELLIGENCE SYSTEM</p>
            <strong>Control Center</strong>
          </div>
          <div className="header-state">
            <span className="live-indicator" aria-hidden="true" />
            <span>LOCAL / ONLINE</span>
          </div>
        </header>
        <main id="main-content" className="app-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
