"use client";

import { copyFollowMessage } from "@zeno/sdk";
import type { Address } from "@zeno/types";
import { Button, ReviewStep, Segmented, TextField } from "@zeno/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useAccountMode } from "@/hooks/useAccountMode";
import { useWalletZeno } from "@/hooks/useZeno";
import { useCopyConfig, useCopyFollows, useSettlementDecimals } from "@/hooks/queries";
import { useTx } from "@/hooks/useTx";
import { COPY_DEFAULTS, COPY_LEVERAGE_CHOICES, capsProblem, postFollow, usdToBase } from "@/lib/copy";
import { shortHash } from "@/lib/format";
import { ConnectButton } from "./ConnectButton";
import { CopyFollows } from "./CopyFollows";
import { PanelState } from "./PanelState";

/// Copy one trader. Budget and limits, then the review step, then up to five confirmations in order: create a copy
/// account, fund it, let Zeno's executor trade in it (and nothing else), and sign the limits. The first four are
/// wallet transactions, the last a signed message; nothing is sent before the review (docs/UI_CONTRACT.md rule 3).
export function CopyFlow({ leader }: { leader: Address }) {
  const mode = useAccountMode();
  const { address } = useAccount();
  const wallet = useWalletZeno();
  const run = useTx();
  const queryClient = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const decimals = useSettlementDecimals().data;
  const config = useCopyConfig();
  const follows = useCopyFollows(address);

  const [budget, setBudget] = useState(COPY_DEFAULTS.budget);
  const [maxTrade, setMaxTrade] = useState(COPY_DEFAULTS.maxTrade);
  const [maxExposure, setMaxExposure] = useState(COPY_DEFAULTS.maxExposure);
  const [maxLeverage, setMaxLeverage] = useState<number>(COPY_DEFAULTS.maxLeverage);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const executor = config.data?.executor;
  const existing = follows.data?.follows.find((f) => f.leader === leader.toLowerCase() && f.active);
  const places = decimals ?? 6;
  const b = usdToBase(budget, places);
  const t = usdToBase(maxTrade, places);
  const e = usdToBase(maxExposure, places);
  const problem = capsProblem({ budget: b, maxTrade: t, maxExposure: e });
  const unsigned = !executor
    ? "Copy trading is not switched on for this network yet."
    : !wallet || !address
      ? "Connect a wallet first."
      : address.toLowerCase() === leader.toLowerCase()
        ? "You cannot copy your own wallet."
        : undefined;

  async function submit() {
    if (!wallet || !address || !executor || !b || !t || !e) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const owned = await wallet.subaccounts.list(address);
      // A new copy account for each follow, so one leader's trades never touch another's margin.
      const used = new Set((follows.data?.follows ?? []).map((f) => f.subaccount.toLowerCase()));
      let sub = owned.find((s) => !used.has(s.address.toLowerCase()))?.address;
      if (!sub) {
        const index = owned.reduce((max, s) => (s.index >= max ? s.index + 1n : max), 0n);
        const created = await run({ title: "Create copy account" }, (tx) => wallet.subaccounts.create(index, tx));
        if (!created.ok) return;
        sub = created.value.address;
      }
      const funded = await run({ title: "Fund copy account", summary: `$${budget}` }, (tx) => wallet.subaccounts.deposit(sub!, b, { tx }));
      if (!funded.ok) return;
      if (!(await wallet.subaccounts.isDelegate(sub, executor))) {
        const allowed = await run({ title: "Let Zeno's executor trade in the copy account" }, (tx) => wallet.subaccounts.setDelegate(sub!, executor, true, tx));
        if (!allowed.ok) return;
      }
      const terms = { follower: address, leader, subaccount: sub, maxTradeSize: t.toString(), maxExposure: e.toString(), maxLeverage, markets: null, issuedAt: Math.floor(Date.now() / 1000) };
      let signature: `0x${string}`;
      try {
        signature = await signMessageAsync({ message: copyFollowMessage(terms) });
      } catch {
        setMessage("The signature was not given, so copying has not started. Your copy account is funded; sign again to start, or withdraw it from the Copy page.");
        return;
      }
      const posted = await postFollow({ ...terms, signature });
      if (!posted.ok) {
        setMessage(posted.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["copy-follows"] });
      setReviewing(false);
      setMessage("Copying has started. New trades by this trader are copied into your copy account from now on.");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "disconnected") {
    return (
      <PanelState action={<ConnectButton />}>
        Connect a wallet to copy a trader. You set a budget and limits, review them, then confirm.
      </PanelState>
    );
  }
  if (existing) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="max-w-prose leading-snug">You are already copying {shortHash(leader)}. Manage it below.</p>
        <CopyFollows only={leader.toLowerCase()} />
      </div>
    );
  }

  const label = `Copy ${shortHash(leader)}`;
  if (reviewing && !problem) {
    return (
      <div className="p-4">
        <ReviewStep
          title={label}
          className="max-w-md"
          rows={[
            { label: "You put in", value: `$${budget} into a separate copy account`, strong: true },
            { label: "Copying", value: shortHash(leader) },
            { label: "How trades are sized", value: "In proportion to balances. If the trader risks 10% of their balance, your copy account risks 10% of its balance." },
            { label: "Already open", value: "Positions they hold now are not copied. Only trades they open from now on." },
            { label: "Limit per trade", value: `$${maxTrade}` },
            { label: "Limit on total exposure", value: `$${maxExposure}` },
            { label: "Highest leverage", value: `${maxLeverage}x` },
            { label: "Who can trade", value: executor ? `Zeno's executor (${shortHash(executor)}) can open and close trades in the copy account. It cannot withdraw.` : "–" },
            { label: "Venue cut", value: "None extra. Each copied trade pays the normal trading fee." },
            { label: "Confirmations", value: "Create account (once), fund, allow executor, then sign your limits." },
          ]}
          worstCase={`Exposure is capped at the $${budget} in the copy account. A trade that would break a limit is skipped and shown with the reason; nothing is copied in part. Stop at any time and withdraw what is left.`}
          blocked={unsigned}
          busy={busy}
          confirmLabel={`Confirm: ${label}`}
          onBack={() => setReviewing(false)}
          onConfirm={submit}
        />
        {message ? <p className="mt-3 max-w-prose leading-snug text-down">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="max-w-prose leading-snug text-muted">
        Copy this trader&apos;s new perp trades into a separate account that holds only the budget you choose. Your main account is never touched.
      </p>
      <TextField label="Budget (USD)" className="max-w-xs" value={budget} onValueChange={setBudget} placeholder="100" invalid={b === undefined} />
      <TextField label="Limit per trade (USD)" className="max-w-xs" value={maxTrade} onValueChange={setMaxTrade} placeholder="200" invalid={t === undefined} />
      <TextField label="Limit on total exposure (USD)" className="max-w-xs" value={maxExposure} onValueChange={setMaxExposure} placeholder="400" invalid={e === undefined} />
      <Segmented<string>
        label="Highest leverage to copy"
        className="max-w-xs"
        value={String(maxLeverage)}
        onChange={(next) => setMaxLeverage(Number(next))}
        options={COPY_LEVERAGE_CHOICES.map((x) => ({ value: String(x), label: `${x}x` }))}
      />
      {problem ? <p className="max-w-prose leading-snug text-down">{problem}</p> : null}
      {message ? <p className="max-w-prose leading-snug">{message}</p> : null}
      <Button variant="primary" className="max-w-xs" disabled={Boolean(problem)} onClick={() => setReviewing(true)}>
        Review
      </Button>
      {unsigned ? <p className="max-w-prose text-xs leading-snug text-muted">{unsigned}</p> : null}
    </div>
  );
}
