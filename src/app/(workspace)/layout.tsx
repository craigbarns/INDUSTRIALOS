import { WorkspaceProvider } from "@/components/workspace";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}
