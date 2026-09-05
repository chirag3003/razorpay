"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/common/error-state";
import { useAuthStore } from "@/store/auth-store";
import {
  decideAuthorizeRequest,
  getAuthorizeRequest,
  OAuthRequestError,
  type AuthorizeRequestInfo,
} from "@/lib/api/oauth";

/**
 * The human side of MCP OAuth (backend/API.md §6.15): `GET /oauth/authorize` on the backend
 * 302-redirects here with `?request_id=...`. This page is the only piece of that flow the backend
 * can't render itself, since it's a pure JSON API.
 *
 * Deliberately not wrapped in the `(shop)` group (no header/footer/chat launcher — this is a
 * standalone consent screen, closest in spirit to `app/admin/login`) and not gated by the shared
 * `RequireAuth` component, which redirects through `/login?next=<pathname>` using `usePathname()`
 * alone — that would drop `request_id` on the way back. This page carries the full path + query
 * itself instead.
 */

type Phase =
  | { kind: "loading" }
  | { kind: "invalid" } // no request_id, or backend says unknown/decided/expired
  | { kind: "error"; message: string } // transient — worth a retry
  | { kind: "ready"; info: AuthorizeRequestInfo };

function AgentConnectContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request_id");

  const authStatus = useAuthStore((state) => state.status);
  const token = useAuthStore((state) => state.token);

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [deciding, setDeciding] = useState<"approve" | "deny" | null>(null);

  const load = useCallback(() => {
    if (!requestId) {
      setPhase({ kind: "invalid" });
      return;
    }
    setPhase({ kind: "loading" });
    getAuthorizeRequest(requestId)
      .then((info) => setPhase({ kind: "ready", info }))
      .catch((err) => {
        if (err instanceof OAuthRequestError && [404, 409, 410].includes(err.status)) {
          setPhase({ kind: "invalid" });
          return;
        }
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
        });
      });
  }, [requestId]);

  useEffect(() => {
    if (authStatus === "authenticated") load();
  }, [authStatus, load]);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      const next = `${pathname}?${searchParams.toString()}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authStatus, pathname, searchParams, router]);

  async function decide(decision: "approve" | "deny") {
    if (!requestId || !token) return;
    setDeciding(decision);
    try {
      const { redirectTo } = await decideAuthorizeRequest(requestId, decision, token);
      // A real cross-origin OAuth redirect back to the agent's redirect_uri — a full navigation,
      // not client-side routing.
      window.location.href = redirectTo;
    } catch (err) {
      if (err instanceof OAuthRequestError && [404, 409, 410].includes(err.status)) {
        setPhase({ kind: "invalid" });
        return;
      }
      toast.error(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setDeciding(null);
    }
  }

  if (authStatus === "idle" || authStatus === "loading" || authStatus === "unauthenticated") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (authStatus === "error") {
    return (
      <div className="mx-auto flex min-h-svh max-w-sm items-center justify-center px-4">
        <ErrorState
          title="We couldn't verify your session"
          description="We couldn't reach the server. Your session is still saved — try again in a moment."
          onRetry={() => useAuthStore.getState().hydrateFromServer()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {phase.kind === "loading" && (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {phase.kind === "invalid" && (
          <Card className="p-5">
            <ErrorState
              title="This link is no longer valid"
              description="This connection request is unknown, already decided, or has expired. Ask the agent to start over."
              compact
            />
          </Card>
        )}

        {phase.kind === "error" && (
          <Card className="p-5">
            <ErrorState title="We're having trouble" description={phase.message} onRetry={load} compact />
          </Card>
        )}

        {phase.kind === "ready" && (
          <>
            <div className="mb-6 flex flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <ShieldCheck className="size-6 text-primary" />
              </div>
              <div className="space-y-1">
                <h1 className="font-heading text-2xl font-semibold">
                  {phase.info.clientName} wants to connect
                </h1>
                <p className="text-sm text-muted-foreground">
                  to your FreshCart account
                </p>
              </div>
            </div>

            <Card className="space-y-4 p-5">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">This will allow it to</p>
                <p className="text-sm">
                  Shop on your behalf — search products, manage your cart, and place orders using
                  your saved Reserve Pay balance.
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">Scope: {phase.info.scope}</p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  disabled={deciding !== null}
                  onClick={() => void decide("approve")}
                >
                  {deciding === "approve" ? "Connecting…" : "Approve"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={deciding !== null}
                  onClick={() => void decide("deny")}
                >
                  {deciding === "deny" ? "…" : "Deny"}
                </Button>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export default function AgentConnectPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <AgentConnectContent />
    </Suspense>
  );
}
