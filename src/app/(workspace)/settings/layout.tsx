"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui";
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your account, workspace, and team access."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings navigation">
          {[
            { title: "Profile", href: "/settings/profile" },
            { title: "Organization", href: "/settings/organization" },
            { title: "Members", href: "/settings/members" },
          ].map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className={path === item.href ? "active" : ""}
              aria-current={path === item.href ? "page" : undefined}
            >
              {item.title}
            </Link>
          ))}
        </nav>
        <div>{children}</div>
      </div>
    </>
  );
}
