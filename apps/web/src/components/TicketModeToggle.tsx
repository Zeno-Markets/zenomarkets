"use client";

import { Segmented } from "@zeno/ui";
import { useModeStore, type TicketMode } from "@/stores/mode";

/// Guided or Pro, for every order ticket at once, remembered on this device with the rest of the shell's
/// choices (`useModeStore`). It sits in each ticket's header, where the difference shows.
export function TicketModeToggle() {
  const ticket = useModeStore((state) => state.ticket);
  const setTicket = useModeStore((state) => state.setTicket);
  return (
    <Segmented<TicketMode>
      label="Ticket layout"
      className="w-fit min-w-36"
      value={ticket}
      onChange={setTicket}
      options={[
        { value: "guided", label: "Guided" },
        { value: "pro", label: "Pro" },
      ]}
    />
  );
}
