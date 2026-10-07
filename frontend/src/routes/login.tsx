import * as React from "react";
import { createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import { Warehouse, Loader2, Eye, EyeOff, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

import {
  getDefaultRouteForUser,
  getSafeRedirectPath,
  getUserInfo,
  isAuthenticated,
} from "@/lib/auth-utils";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    // Skip server-side redirects for localStorage-based auth
    if (typeof window === "undefined") return;

    if (isAuthenticated()) {
      const user = getUserInfo();
      throw redirect({ to: getDefaultRouteForUser(user) as any });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as any;
  const redirectPath = getSafeRedirectPath(search.redirect || search.next);
  const magicToken = search.token;

  const [employeeId, setEmployeeId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [verifyingMagicLink, setVerifyingMagicLink] = React.useState(false);

  // Handle auto-login via magic token with 24h expiration check
  React.useEffect(() => {
    if (magicToken && !isLoading && !verifyingMagicLink) {
      const performAutoLogin = async () => {
        setIsLoading(true);
        setVerifyingMagicLink(true);
        setLinkError(null);
        try {
          let data: any;
          // If token has '.' or is not base64 "u:p", call magicLogin
          if (magicToken.includes(".") || !magicToken.includes(":")) {
            data = await api.magicLogin(magicToken);
          } else {
            try {
              const decoded = atob(magicToken);
              const [u, p] = decoded.split(":");
              data = await api.login(u, p);
            } catch {
              data = await api.magicLogin(magicToken);
            }
          }
          toast.success("Access link verified! Opening quotation portal...");
          const target = data?.rfq_id
            ? `/submit-quotation?rfqId=${data.rfq_id}`
            : redirectPath || "/supplier-dashboard";
          
          setTimeout(() => {
            navigate({ to: target as any });
          }, 300);
        } catch (error: any) {
          console.error("Auto-login failed:", error);
          const rawMsg = error?.message || error?.detail || "";
          const isExpired = rawMsg.toLowerCase().includes("expired") || error?.status === 410;
          const userMsg = isExpired
            ? "This quotation invitation link has expired after 24 hours. For security, please contact procurement for a new access link."
            : (rawMsg || "This quotation access link is invalid or expired. Please contact procurement.");
          setLinkError(userMsg);
          toast.error(userMsg);
        } finally {
          setIsLoading(false);
          setVerifyingMagicLink(false);
        }
      };
      void performAutoLogin();
    }
  }, [magicToken]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !password) {
      toast.error("Please enter both Employee ID and password");
      return;
    }

    setIsLoading(true);
    try {
      const data = await api.login(employeeId, password, rememberMe);
      completeAuthentication(data);
    } catch (error: any) {
      toast.error(error.message || "Login failed. Please check your credentials.");
    } finally {
      setIsLoading(false);
    }
  };

  const completeAuthentication = (data: any) => {
    toast.success(`Welcome back, ${data.username}!`);
    const targetPath = redirectPath || getDefaultRouteForUser(data);

    setTimeout(() => {
      // Keep route transitions internal. `redirectPath` has already rejected external URLs.
      const target = new URL(targetPath, window.location.origin);
      navigate({
        to: target.pathname as any,
        search: Object.fromEntries(target.searchParams) as any,
        hash: target.hash,
      });
    }, 500);
  };

  const handleForgotPassword = () => {
    toast.info("Please contact your IT administrator to reset your password.");
  };

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      {/* Left side - Illustration/Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-primary p-12 text-primary-foreground relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Warehouse className="h-8 w-8" />
            <span>KaizenX</span>
          </div>
          <div className="mt-20">
            <h1 className="text-5xl font-extrabold leading-tight">
              Warehouse Management <br /> Simplified.
            </h1>
            <p className="mt-6 text-xl text-primary-foreground/80 max-w-lg">
              Optimizing your supply chain with real-time tracking, intelligent dock management, and
              seamless arrival workflows.
            </p>
          </div>
        </div>

        <div className="relative z-10 mt-auto">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 max-w-md">
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium">Enterprise Security</p>
              <p className="text-xs text-primary-foreground/60">
                End-to-end encryption and multi-factor authentication for all warehouse operations.
              </p>
            </div>
          </div>
        </div>

        {/* Mesh Background Pattern */}
        <div className="absolute inset-0 z-0 opacity-20">
          <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <radialGradient id="mesh-gradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                <stop offset="0%" stopColor="white" />
                <stop offset="100%" stopColor="transparent" />
              </radialGradient>
            </defs>
            <circle cx="20" cy="20" r="40" fill="url(#mesh-gradient)" />
            <circle cx="80" cy="50" r="30" fill="url(#mesh-gradient)" />
            <circle cx="40" cy="80" r="45" fill="url(#mesh-gradient)" />
          </svg>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex flex-1 items-center justify-center bg-background p-6 lg:p-12">
        <div className="mx-auto w-full max-w-[400px] space-y-6">
          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <div className="lg:hidden flex justify-center mb-6">
              <div className="flex items-center gap-2 text-2xl font-bold text-primary">
                <Warehouse className="h-8 w-8" />
                <span>KaizenX</span>
              </div>
            </div>
            <h2 className="text-3xl font-bold tracking-tight">Staff Login</h2>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to access the management console.
            </p>
          </div>

          {verifyingMagicLink && (
            <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-primary">
              <Loader2 className="size-5 animate-spin shrink-0" />
              <div>
                <p className="font-semibold">Verifying secure quotation link...</p>
                <p className="text-xs text-muted-foreground">Authenticating and opening supplier workspace.</p>
              </div>
            </div>
          )}

          {linkError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              <div className="flex items-center gap-2 font-semibold">
                <Clock className="size-4 shrink-0" /> Quotation Link Expired or Invalid
              </div>
              <p className="mt-1 text-xs leading-relaxed">{linkError}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Quotation links expire 24 hours after issuance. You can still log in manually below if you have portal credentials.
              </p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="employeeId">Employee ID / Username</Label>
              <Input
                id="employeeId"
                placeholder="Enter your employee ID or username"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>


            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked as boolean)}
              />
              <Label
                htmlFor="remember"
                className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Remember me on this device
              </Label>
            </div>
            <Button type="submit" className="w-full font-bold" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              By signing in, you agree to our Terms of Service and Privacy Policy.
              <br />
              &copy; 2026 KaizenX Industrial Systems.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
