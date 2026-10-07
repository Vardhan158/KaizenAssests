import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/receiving")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      throw redirect({
        to: "/dock-management",
        replace: true,
      });
    }
  },
  component: ReceivingRedirect,
});

function ReceivingRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({
      to: "/dock-management",
      replace: true,
    });
  }, [navigate]);

  return null;
}

