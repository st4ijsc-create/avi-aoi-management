/**
 * P3-W2 — Action Inbox full-screen route (`/inbox`).
 *
 * The Action Inbox surface (<AIActionInbox/>) is a slide-over (Sheet) normally
 * opened from the header launcher. This thin wrapper page mounts it in the
 * always-open state on its own route so it has a stable, deep-linkable URL in
 * the ME nav group (read-open to every authenticated role). Closing the sheet
 * returns the user to the dashboard.
 *
 * No inbox logic is duplicated here — the component owns all queries, realtime
 * refresh and the HITL approve/dismiss flow.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { AIActionInbox } from "@/components/AIActionInbox";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(true);

  return (
    <AIActionInbox
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setLocation("/dashboard");
      }}
    />
  );
}
