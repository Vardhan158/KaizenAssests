import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { isRedirect, isNotFound } from "@tanstack/react-router";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isRequestAbort(error)) {
      return new Response(null, { status: 499 });
    }
    if (
      isRedirect(error) ||
      isNotFound(error) ||
      (error != null && typeof error === "object" && ("statusCode" in error || "status" in error))
    ) {
      throw error;
    }
    console.error("START ERROR MIDDLEWARE CATCH:", error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

function isRequestAbort(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (current instanceof Error) {
      const candidate = current as Error & { code?: unknown };
      if (
        candidate.name === "AbortError" ||
        candidate.message === "aborted" ||
        candidate.code === "ECONNRESET"
      ) {
        return true;
      }
      current = candidate.cause;
      continue;
    }
    return false;
  }
  return false;
}

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
