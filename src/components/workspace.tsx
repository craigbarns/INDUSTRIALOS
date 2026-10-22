"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Activity,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  X,
} from "lucide-react";
import { ApiError, type Workspace, useResource } from "@/lib/client";
import { authClient } from "@/lib/auth-client";
import { Button, Loading, Notice } from "@/components/ui";

const WorkspaceContext = createContext<{
  workspace: Workspace;
  refresh: () => void;
} | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace unavailable");
  return context;
}
export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Activity size={18} strokeWidth={2.2} />
      </div>
      <span className="brand-text">INDUSTRIAL OS</span>
    </div>
  );
}
const nav = [
  {
    label: "Workspace",
    items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Procurement",
    items: [{ title: "Projects", href: "/projects", icon: FolderOpen }],
  },
  {
    label: "Intelligence",
    items: [{ title: "Documents", href: "/documents", icon: FileText }],
  },
  {
    label: "Network & insights",
    items: [
      { title: "Suppliers", href: "/suppliers", icon: Users },
      { title: "Analytics", href: "/analytics", icon: BarChart3 },
    ],
  },
];

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, refresh } =
    useResource<Workspace>("/api/workspace");
  const router = useRouter();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401)
      router.replace("/login");
    else if (data && !data.organization) router.replace("/onboarding");
  }, [data, error, router]);
  if (
    loading ||
    (error instanceof ApiError && error.status === 401) ||
    (data && !data.organization)
  )
    return <Loading />;
  if (error || !data)
    return (
      <main className="standalone">
        <div className="auth-card">
          <Brand />
          <h1>Workspace unavailable</h1>
          <Notice>
            {error?.message ??
              "Please check the application configuration and try again."}
          </Notice>
          <Button onClick={refresh}>Try again</Button>
          <Link className="text-link" href="/login">
            Return to sign in
          </Link>
        </div>
      </main>
    );
  return (
    <WorkspaceContext.Provider value={{ workspace: data, refresh }}>
      <AppShell>{children}</AppShell>
    </WorkspaceContext.Provider>
  );
}
function AppShell({ children }: { children: ReactNode }) {
  const { workspace, refresh } = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const open = menuPath === path;
  const setOpen = (value: boolean) => setMenuPath(value ? path : null);
  const [switchError, setSwitchError] = useState("");
  const { resolvedTheme, setTheme } = useTheme();
  const current = [
    ...nav.flatMap((group) => group.items),
    { title: "Settings", href: "/settings" },
  ].find((item) => path === item.href || path.startsWith(item.href + "/"));
  async function switchOrg(id: string) {
    setSwitchError("");
    const result = await authClient.organization.setActive({
      organizationId: id,
    });
    if (result.error)
      setSwitchError(result.error.message ?? "Unable to switch workspace.");
    else {
      refresh();
      // Discard all client caches when the tenant changes, including an open review.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard");
    }
  }
  return (
    <div className="app-shell">
      <a className="sr-only focus:not-sr-only" href="#main-content">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${open ? "is-open" : ""}`}
        aria-label="Main navigation"
      >
        <Link href="/dashboard" aria-label="Industrial OS dashboard">
          <Brand />
        </Link>
        <div className="workspace-selector">
          <div className="workspace-avatar">
            {workspace.organization?.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="grow">
            <strong className="truncate">{workspace.organization?.name}</strong>
            <small>Enterprise workspace</small>
          </div>
          <ChevronDown size={13} className="muted" />
          <select
            aria-label="Switch organization"
            value={workspace.organization?.id ?? ""}
            onChange={(e) => {
              void switchOrg(e.target.value);
            }}
          >
            {workspace.organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
        {nav.map((group) => (
          <div key={group.label} className="nav-group">
            <div className="nav-caption">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                className={`nav-item ${path === item.href || path.startsWith(item.href + "/") ? "active" : ""}`}
                aria-current={
                  path === item.href || path.startsWith(item.href + "/")
                    ? "page"
                    : undefined
                }
                href={item.href}
              >
                <item.icon />
                <span>{item.title}</span>
              </Link>
            ))}
          </div>
        ))}
        <div className="sidebar-bottom">
          <div className="nav-group">
            <Link
              className={`nav-item ${path.startsWith("/settings") ? "active" : ""}`}
              href="/settings/profile"
            >
              <Settings />
              <span>Settings</span>
            </Link>
          </div>
          <div className="workspace-note">
            <strong>
              <ShieldCheck
                size={12}
                style={{
                  display: "inline",
                  verticalAlign: "-2px",
                  marginRight: 5,
                }}
              />{" "}
              Private by design
            </strong>
            Your industrial documents stay within your organization.
          </div>
          <div className="user-box">
            <div className="user-avatar">
              {workspace.user.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
            <div className="grow">
              <strong className="truncate">{workspace.user.name}</strong>
              <p className="truncate">{workspace.user.email}</p>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                const result = await authClient.signOut();
                if (!result.error) router.replace("/login");
                else
                  setSwitchError(result.error.message ?? "Could not sign out.");
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="breadcrumb">
            <Building2 size={13} />
            <span className="truncate">{workspace.organization?.name}</span>
            <ChevronRight size={11} />
            <strong>{current?.title ?? "Workspace"}</strong>
          </div>
          <div className="secure-indicator">
            <ShieldCheck size={12} />
            Secure workspace
          </div>
          <button
            className="icon-button"
            aria-label="Toggle color theme"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
          >
            <Sun size={16} className="hidden dark:block" />
            <Moon size={16} className="dark:hidden" />
          </button>
          <Link
            href="/settings/members"
            className="icon-button"
            aria-label="Organization members"
          >
            <Users size={16} />
          </Link>
        </header>
        <main id="main-content" className="page-content">
          {switchError && <Notice>{switchError}</Notice>}
          {children}
        </main>
      </div>
    </div>
  );
}
