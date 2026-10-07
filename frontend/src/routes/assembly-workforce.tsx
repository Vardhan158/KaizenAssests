import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/assembly-workforce")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      throw redirect({
        to: "/assembly-dashboard",
        replace: true,
      });
    }
  },
  component: AssemblyWorkforceRedirect,
});

function AssemblyWorkforceRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({
      to: "/assembly-dashboard",
      replace: true,
    });
  }, [navigate]);

  return null;
}
