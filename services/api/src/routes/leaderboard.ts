import type { Zeno } from "@zeno/sdk";
import type { FastifyInstance } from "fastify";
import { stringToHex } from "viem";
import { getSql } from "../db.js";
import {
  ADDRESS,
  buildPnlCard,
  entriesFromRows,
  parseBoardQuery,
  parseVisibilityBody,
  parseWalletList,
  signatureMatches,
  syntheticBoard,
  VISIBILITY_WINDOW_SECONDS,
  type BoardResponse,
  type OpenedEvent,
  type PositionEvent,
  type StatsRow,
} from "../leaderboard.js";

type Sql = ReturnType<typeof getSql>;

/// The fees a trader pays on a perp position's own transactions. Option fees are not here: the PNL card
/// is for perps, and an option's close and settlement fees are already inside its realised PNL.
const CARD_FEE_TYPES = ["TAKER", "LIQUIDATION"].map((label) => stringToHex(label, { size: 32 }));

/// The leaderboard and the PNL card, both read-only over what `services/indexer` derived into
/// `trader_stats` and recorded in `events`. The one write is a wallet's own privacy choice.
export function registerLeaderboardRoutes(app: FastifyInstance, zeno: Zeno, sql: Sql = getSql(), sampleWalletsEnv = process.env.SAMPLE_WALLETS) {
  const sampleWallets = new Set(parseWalletList(sampleWalletsEnv));

  /// The settlement token's decimals never change, and the SDK reads them once.
  const decimals = () => zeno.erc20.decimals(zeno.addresses.settlementToken);

  async function isHidden(wallet: string): Promise<boolean> {
    const [row] = await sql<{ hidden: boolean }[]>`select hidden from leaderboard_visibility where wallet = ${wallet}`;
    return row?.hidden === true;
  }

  /// Ranked by total PNL (realised plus unrealised), ROI, or volume, each descending as a number. Ties break
  /// on volume descending, then wallet ascending, so the order never shuffles between refreshes. A wallet
  /// that opted out is not on the board. Amounts are decimal strings in settlement-token base units.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/leaderboard", async (request, reply) => {
    const query = parseBoardQuery(request.query);
    if ("error" in query) return reply.code(400).send({ error: query.error });
    const settlementDecimals = await decimals();

    // The sample board is the simulator's bots when they have traded, and a fixed synthetic board when not.
    if (query.sample && sampleWallets.size === 0) return syntheticBoard(query, settlementDecimals);

    const onlySample = query.sample ? sql`and ts.wallet in ${sql([...sampleWallets])}` : sql``;
    const order = {
      pnl: sql`(ts.realised_pnl::numeric + ts.unrealised_pnl::numeric) desc`,
      roi: sql`ts.roi_bps::numeric desc`,
      volume: sql`ts.volume::numeric desc`,
    }[query.metric];

    const [rows, [summary]] = await Promise.all([
      sql<StatsRow[]>`
        select ts.wallet, ts.realised_pnl, ts.unrealised_pnl,
          (ts.realised_pnl::numeric + ts.unrealised_pnl::numeric)::text as total_pnl,
          ts.roi_bps, ts.volume, ts.trade_count, ts.win_rate_bps
        from trader_stats ts
        left join leaderboard_visibility v on v.wallet = ts.wallet
        where ts."window" = ${query.window} and coalesce(v.hidden, false) = false ${onlySample}
        order by ${order}, ts.volume::numeric desc, ts.wallet asc
        limit ${query.limit} offset ${query.offset}
      `,
      sql<{ total: number; updatedAt: Date | null }[]>`
        select count(*)::int as total, max(ts.updated_at) as updated_at
        from trader_stats ts
        left join leaderboard_visibility v on v.wallet = ts.wallet
        where ts."window" = ${query.window} and coalesce(v.hidden, false) = false ${onlySample}
      `,
    ]);

    if (query.sample && (summary?.total ?? 0) === 0) return syntheticBoard(query, settlementDecimals);

    const body: BoardResponse = {
      metric: query.metric,
      window: query.window,
      sample: query.sample,
      updatedAt: summary?.updatedAt ? new Date(summary.updatedAt).toISOString() : null,
      settlementDecimals,
      total: summary?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
      entries: entriesFromRows(rows, query.offset, sampleWallets),
    };
    return body;
  });

  app.get<{ Params: { wallet: string } }>("/v1/leaderboard/visibility/:wallet", async (request, reply) => {
    if (!ADDRESS.test(request.params.wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    const wallet = request.params.wallet.toLowerCase();
    return { wallet, hidden: await isHidden(wallet) };
  });

  /// Sets whether a wallet is hidden. The wallet proves it with an EIP-191 signature over a fixed message
  /// (see `visibilityMessage`), so nobody can hide another wallet. The signed time must be recent and must be
  /// newer than the last accepted change, so a captured signature cannot be replayed to undo a later choice.
  app.post<{ Body: unknown }>("/v1/leaderboard/visibility", async (request, reply) => {
    const parsed = parseVisibilityBody(request.body);
    if ("error" in parsed) return reply.code(400).send({ error: parsed.error });

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.issuedAt) > VISIBILITY_WINDOW_SECONDS) {
      return reply.code(400).send({ error: `issuedAt must be within ${VISIBILITY_WINDOW_SECONDS / 60} minutes of now` });
    }
    if (!(await signatureMatches(parsed))) return reply.code(401).send({ error: "signature does not match the wallet" });

    const saved = await sql`
      insert into leaderboard_visibility (wallet, hidden, issued_at)
      values (${parsed.wallet}, ${parsed.hidden}, ${parsed.issuedAt})
      on conflict (wallet) do update
        set hidden = excluded.hidden, issued_at = excluded.issued_at, updated_at = now()
        where leaderboard_visibility.issued_at < excluded.issued_at
      returning wallet
    `;
    if (saved.length === 0) return reply.code(409).send({ error: "a newer change to this wallet's visibility was already accepted" });
    return { wallet: parsed.wallet, hidden: parsed.hidden };
  });

  /// One perp position as a shareable card. Ownership, side, leverage, times and every PNL component come
  /// from the event log; the chain supplies the position's weighted entry price, current size and, while it
  /// is open, the live mark.
  app.get<{ Params: { wallet: string; positionId: string } }>("/v1/pnl-card/:wallet/:positionId", async (request, reply) => {
    const { wallet: rawWallet, positionId } = request.params;
    if (!ADDRESS.test(rawWallet)) return reply.code(400).send({ error: "wallet must be an address" });
    if (!/^\d{1,20}$/.test(positionId)) return reply.code(400).send({ error: "positionId must be a whole number" });
    const wallet = rawWallet.toLowerCase();
    const notFound = () => reply.code(404).send({ error: `no position ${positionId} for wallet ${wallet}` });

    const [opened] = await sql<(OpenedEvent & { args: Record<string, unknown> })[]>`
      select tx_hash, created_at, args from events
      where event_name = 'PerpPositionOpened' and args ->> 'positionId' = ${positionId}
      limit 1
    `;
    if (!opened) return notFound();
    const args = opened.args;
    // A position of another wallet, and one whose owner opted out, are both just "not found".
    if (String(args.owner).toLowerCase() !== wallet || (await isHidden(wallet))) return notFound();

    const later = await sql<PositionEvent[]>`
      select event_name, tx_hash, args, created_at from events
      where event_name in ('PerpPositionUpdated', 'PerpPositionClosed', 'PositionLiquidated', 'FundingPaid')
        and args ->> 'positionId' = ${positionId}
      order by block_number, log_index
    `;

    const feeTxs = [opened.txHash, ...later.filter((event) => event.eventName !== "FundingPaid").map((event) => event.txHash)];
    const [feeRow] = await sql<{ fees: string }[]>`
      select coalesce(sum((args ->> 'amount')::numeric), 0)::text as fees from events
      where event_name = 'ProtocolFeeCollected'
        and lower(args ->> 'payer') = ${wallet}
        and args ->> 'feeType' in ${sql(CARD_FEE_TYPES)}
        and tx_hash in ${sql(feeTxs)}
    `;

    let chain;
    let markPrice: bigint | null = null;
    try {
      chain = await zeno.portfolio.getPerpPosition(BigInt(positionId));
      if (chain.open) {
        try {
          markPrice = (await zeno.oracle.getMarkPrice(chain.marketId)).price;
        } catch {
          // Session shut or market paused: the card still renders, with no mark and no unrealised PNL.
          markPrice = null;
        }
      }
    } catch (error) {
      request.log.error({ err: error }, "pnl-card: chain read failed");
      return reply.code(502).send({ error: "chain unavailable" });
    }

    return buildPnlCard({
      wallet,
      positionId,
      opened: {
        owner: wallet,
        marketId: String(args.marketId),
        isLong: args.isLong === true,
        size: String(args.size),
        collateral: String(args.collateral),
        leverage: String(args.leverage),
        createdAt: new Date(opened.createdAt),
        txHash: opened.txHash,
      },
      later: later.map((event) => ({ ...event, createdAt: new Date(event.createdAt) })),
      fees: BigInt(feeRow?.fees ?? "0"),
      chain: { open: chain.open, entryPrice: chain.entryPrice, size: chain.size, collateral: chain.collateral },
      markPrice,
      settlementDecimals: await decimals(),
      sample: sampleWallets.has(wallet),
    });
  });
}
