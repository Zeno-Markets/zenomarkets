/// The landing page's frame, after zupiter.tech: the content takes about 91% of the viewport, with a
/// fluid gutter (54 px per side at 1280, 80 at 1920, 112 at 2560) and a very wide cap. The header and the
/// bottom rail share it, so the wordmark and the wallet button sit on the same edges as the content.
export const LANDING_FRAME =
    'mx-auto w-full max-w-[2560px] px-4 sm:px-6 md:px-[clamp(40px,4.2vw,112px)]';

/// The reading frame of `/docs`: a column capped at 1600 px, so long prose and tables stay readable.
export const PAGE_FRAME =
    'mx-auto w-full max-w-[1600px] px-4 sm:px-8 lg:px-[42px] xl:px-[70px]';

/// The heading of a landing page section, in the voice of the hero title: serif, tight tracking, full
/// brightness against the dark ground every section now shares with the hero.
export const SECTION_TITLE =
    'font-display text-[2.25rem] font-bold leading-[1.08] tracking-[-0.03em] text-text sm:text-[3.25rem]';

/// For verifiable data only — a contract address, a chain name, a tech-stack tag — never prices or
/// tickers, which stay in the sans everywhere else so the landing page still matches the terminal.
export const MONO = 'font-mono tabular-nums';

/// The wide-tracked small caps of the landing page's section labels and rail, after the reference's
/// `01 / ROUTING, CONSIDERED` line. Same sans and palette as the rest of the app.
export const SPACED_CAPS = 'text-[11px] font-medium uppercase tracking-[0.28em]';

/// A small tracked uppercase label, on a button or a chip-style link. One source instead of the same
/// string re-typed in every caller — the tracked-caps treatment itself is a deliberate financial-
/// terminal convention (PROJECT_BRIEF.md's "precise typography"), not the generic eyebrow-label tell;
/// this only removes the duplication.
export const CHIP_LABEL = 'text-[13px] font-medium uppercase tracking-[0.04em]';

/// The side gutter of every app page and of the header above it, so their edges line up. 16px on a
/// phone (docs/UI_CONTRACT.md Section 3 rule 7), then 24px and 40px. Pages are full width by default:
/// a width cap is what creates dead gutters on a wide screen.
export const APP_GUTTER = 'px-4 sm:px-6 lg:px-10';
