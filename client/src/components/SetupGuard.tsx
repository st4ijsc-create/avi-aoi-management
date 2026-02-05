import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

/**
 * Component to check if initial admin setup is required
 * Redirects to /setup if no admin exists
 */
export function SetupGuard({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery();
  const { data: setupRequired, isLoading: checkingSetup } = trpc.auth.checkSetupRequired.useQuery();

  useEffect(() => {
    // If setup is required and user is not authenticated, redirect to setup
    if (!isLoading && !checkingSetup && setupRequired?.required) {
      const currentPath = window.location.pathname;
      // Don't redirect if already on setup page
      if (currentPath !== "/setup") {
        setLocation("/setup");
      }
    }
  }, [setupRequired, isLoading, checkingSetup, setLocation]);

  // Show loading while checking
  if (isLoading || checkingSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Đang kiểm tra hệ thống...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
