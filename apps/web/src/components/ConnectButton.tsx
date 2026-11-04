"use client";

import { Button, type ButtonProps, cn, menuItem } from "@zeno/ui";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { connectMessage, useWalletChoices, useWalletConnect } from "@/hooks/useWalletConnect";
import { useConnectDialog } from "@/stores/connectDialog";
import { useModeStore } from "@/stores/mode";

/// One button for every place that needs a wallet. The first time, it opens the connect explainer:
/// what a wallet does here and the caps. After that, with one wallet available it connects straight away; with several it opens a
/// list; when connecting fails it says why.
export function ConnectButton({
  variant = "primary",
  size = "md",
  className,
  block = false,
  menuAbove = false,
}: Pick<ButtonProps, "variant" | "size" | "className"> & {
  /// Fill the width of the parent, for the mobile menu.
  block?: boolean;
  /// Open the wallet list above the button, for a button at the bottom of a sheet.
  menuAbove?: boolean;
}) {
  const { isPending, error, reset, connectWith } = useWalletConnect();
  const explainerSeen = useModeStore((state) => state.explainerSeen);
  const show = useConnectDialog((state) => state.show);
  const choices = useWalletChoices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);
  useDismiss(ref, open, close);

  function start() {
    if (!explainerSeen) return show();
    if (choices.length === 1) {
      setOpen(false);
      connectWith(choices[0]!, undefined, () => setOpen(true));
    } else {
      setOpen((value) => !value);
    }
  }

  return (
    <div ref={ref} className={cn("relative", block && "w-full")}>
      <Button variant={variant} size={size} className={cn(className, block && "w-full")} disabled={isPending} aria-haspopup={explainerSeen && choices.length > 1 ? "menu" : undefined} aria-expanded={open} onClick={start}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
      {open ? (
        <div role="menu" className={cn("absolute right-0 z-50 w-64 max-w-full rounded-lg border border-line bg-raised p-1", menuAbove ? "bottom-full mb-1" : "top-full mt-1")}>
          {error ? (
            <p role="alert" className="p-2 text-xs leading-snug text-down">
              {connectMessage(error)}
            </p>
          ) : null}
          {choices.length === 0 ? (
            <p className="p-2 text-xs leading-snug text-muted">{connectMessage(Object.assign(new Error(), { name: "ProviderNotFoundError" }))}</p>
          ) : choices.length === 1 ? null : (
            choices.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                role="menuitem"
                onClick={() => {
                  reset();
                  connectWith(connector, () => setOpen(false));
                }}
                className={cn(menuItem, "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm")}
              >
                {connector.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
