"use client";

import { cn } from "@zeno/ui";
import { LISTED_CONTRACTS, type ContractRow } from "@/lib/contracts";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { MONO, SPACED_CAPS } from "@/lib/frame";

const GROUPS: ReadonlyArray<{ id: ContractRow["group"]; title: string }> = [
    { id: "Core", title: "Core stack" },
    { id: "Lending", title: "Lending stack" },
];

/// Every contract of the chosen network at its proxy address, with an explorer link. It reads the network in this
/// browser, so it follows the header's choice and is never the build network's list on another network. A contract
/// that is not deployed here is not listed.
export function ContractsTable() {
    return (
        <div className="relative overflow-x-auto rounded-panel border border-line/70 bg-surface">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Every contract ZENO runs on, with its address and a link to the explorer</caption>
                <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                        <th scope="col" className="px-4 py-3 font-medium">
                            Contract
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                            What it does
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                            Address
                        </th>
                    </tr>
                </thead>
                {GROUPS.map((group) => {
                    const rows = LISTED_CONTRACTS.filter((row) => row.group === group.id);
                    if (rows.length === 0) return null;
                    return (
                        <tbody key={group.id} className="divide-y divide-line border-t border-line">
                            <tr>
                                <th colSpan={3} scope="colgroup" className={cn(SPACED_CAPS, "bg-raised/60 px-4 py-2 text-left font-medium text-muted")}>
                                    {group.title} · {rows.length}
                                </th>
                            </tr>
                            {rows.map((row) => {
                                const url = explorerAddressUrl(env.explorerUrl, row.address);
                                return (
                                    <tr key={`${row.label}-${row.address}`}>
                                        <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-medium">
                                            {row.label}
                                        </th>
                                        <td className="px-4 py-3 text-muted">{row.description}</td>
                                        <td className={cn(MONO, "px-4 py-3 text-xs")}>
                                            {url ? (
                                                <a href={url} target="_blank" rel="noreferrer" className="break-all underline decoration-line underline-offset-4 transition-colors duration-150 hover:text-accent-fg">
                                                    {row.address}
                                                </a>
                                            ) : (
                                                <span className="break-all">{row.address}</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    );
                })}
            </table>
        </div>
    );
}
