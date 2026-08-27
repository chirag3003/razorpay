import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you're looking for doesn't exist or may have been moved."
        action={{ label: "Back to home", href: "/" }}
      />
    </div>
  );
}
