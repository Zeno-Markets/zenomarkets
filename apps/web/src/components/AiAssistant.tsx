"use client";

import { Button, Skeleton, cn, fieldBorder } from "@zeno/ui";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import mark from "@/assets/zeno-mark.png";
import { useTerminal } from "@/stores/terminal";
import { AiError, askAi, failureText, fmtSourceTime, isLimit, suggestions, type AiMessage } from "@/lib/ai";

const SPARK = "M12 2C12.8 8 16 11.2 22 12C16 12.8 12.8 16 12 22C11.2 16 8 12.8 2 12C8 11.2 11.2 8 12 2Z";

/// The ZENOMARKETS glass tile, rounded as in the header logo: the assistant's face beside each answer.
function Avatar({ large = false }: { large?: boolean }) {
  return <Image src={mark} alt="" aria-hidden="true" className={cn("mt-0.5 shrink-0 rounded-[22%] shadow-card", large ? "size-8" : "size-6")} />;
}

/// The panel's slide lasts this long.
const MOTION_MS = 200;

/// The question field grows with its text up to this height, then scrolls. The API keeps 2,000 characters a message.
const FIELD_MAX_PX = 160;
const QUESTION_CHARS = 2000;

const HEAD_BUTTON = "grid size-9 min-w-[44px] place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-raised hover:text-text";

/// "Ask Zeno": a chat sheet, laid out like Gemini: a greeting and suggestion tiles when empty, the user's words in a
/// soft pill on the right, answers as plain text beside the assistant's face with source chips under them, and a rounded
/// input bar with a round send button. It explains the open market from ZENOMARKETS data. It only reads, so it works
/// without a wallet (the not-connected state needs no handling: there is nothing here that signs or sends). Answers
/// arrive whole, after a loading row; nothing is typed out. Every answer lists its sources with the time of the data.
///
/// It opens as the full panel (a full-height sheet on a phone, a tall card on a wide screen) and shrinks to a mini panel in
/// the bottom-right corner, about a third of the height, with the size button. The minimize button folds it
/// back into the round button; the conversation stays. Nothing else on the page is dimmed or blurred, and the page stays
/// usable behind it: only a shadow lifts the panel. Opening, closing and resizing take 200 ms; under reduced motion they
/// collapse to nothing (globals.css).
///
/// States: loading (the row), empty (greeting and suggested questions), error and limit reached (a sentence and a way
/// on), success (the answer and its sources), and the line "Zeno can make mistakes, not financial advice" which is always on screen.
export function AiAssistant() {
  // The market open in the terminal, if any; empty on a page that has none, and the assistant then answers about any market.
  const symbol = useTerminal((state) => state.symbol);
  // The two terminals pin a Long / Short (or option) bar to the bottom on a phone; the button rides above it.
  const barBelow = /^\/(perpetuals|options)/.test(usePathname());
  // `open` is the intent, `mounted` keeps the sheet in the page while it slides out, `shown` is the slid-in look.
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // The full size is the default; the mini size is one tap away, and the choice is kept while the page stays open.
  const [full, setFull] = useState(true);
  // An answer arrived while the panel was minimized.
  const [unread, setUnread] = useState(false);
  const openRef = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The conversation belongs to a market: opening another market starts a fresh one.
  const [chat, setChat] = useState<{ symbol: string; messages: AiMessage[] }>({ symbol, messages: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AiError>();
  const [draft, setDraft] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // More than one line: the bar's corners soften so a tall field does not become a pill.
  const [tall, setTall] = useState(false);
  // Another market starts a fresh conversation. The market list arriving (empty symbol to NVDA) does not: a question asked
  // while it loads stays.
  const sameMarket = !chat.symbol || !symbol || chat.symbol === symbol;
  const messages = sameMarket ? chat.messages : [];

  const openSheet = () => {
    clearTimeout(closing.current);
    setMounted(true);
    setOpen(true);
    openRef.current = true;
    setUnread(false);
    // Two frames: the closed look is painted first, so the change to the open look is a transition.
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };
  const closeSheet = () => {
    openRef.current = false;
    setOpen(false);
    setShown(false);
    closing.current = setTimeout(() => setMounted(false), MOTION_MS);
  };
  useEffect(() => () => clearTimeout(closing.current), []);

  const lastSymbol = useRef(symbol);
  useEffect(() => {
    if (lastSymbol.current && symbol && lastSymbol.current !== symbol) {
      setError(undefined);
      setDraft("");
    }
    lastSymbol.current = symbol;
  }, [symbol]);

  // Not a modal: the page behind stays live. Focus moves into the panel on open and back to the button on minimize, and
  // Escape (pressed inside the panel) minimizes. Only the full sheet on a phone covers the page, so only it holds the scroll.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    // Escape minimizes when focus is in the panel or nowhere (a disabled input drops it); a key pressed in the page's own
    // fields is theirs.
    const onKey = (event: KeyboardEvent) => {
      const here = document.activeElement;
      if (event.key === "Escape" && (!here || here === document.body || panel.current?.contains(here))) closeSheet();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open || !full) return;
    const phone = window.matchMedia("(max-width: 1023px)").matches;
    const main = document.getElementById("main");
    const previous = main?.style.overflow ?? "";
    if (phone && main) main.style.overflow = "hidden";
    return () => {
      if (main) main.style.overflow = previous;
    };
  }, [open, full]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending, error]);

  async function run(thread: AiMessage[]) {
    setChat({ symbol, messages: thread });
    setPending(true);
    setError(undefined);
    try {
      const { answer, sources } = await askAi(symbol, thread);
      setChat((current) => (!current.symbol || !symbol || current.symbol === symbol ? { symbol: current.symbol || symbol, messages: [...current.messages, { role: "assistant", content: answer, sources }] } : current));
      if (!openRef.current) setUnread(true);
    } catch (caught) {
      setError(caught instanceof AiError ? caught : new AiError("unavailable"));
    } finally {
      setPending(false);
    }
  }

  const ask = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    setDraft("");
    void run([...messages, { role: "user", content: question }]);
  };
  // The field is as tall as its text (one row to FIELD_MAX_PX), the way chat apps do it.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX_PX)}px`;
    setTall(el.scrollHeight > 52);
  }, [draft, mounted, full]);
  // Enter sends and Shift + Enter starts a new line. On a touch screen Enter is the keyboard's new line (the round button
  // sends), and Enter while an input method is composing text (Chinese, Japanese) only confirms the text.
  const onFieldKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    ask(draft);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };
  const newChat = () => {
    setChat({ symbol, messages: [] });
    setError(undefined);
    setDraft("");
  };

  // A day's limit or a switched-off assistant will not clear by trying again, so there is no retry or input for them.
  const stuck = error?.failure === "daily_limit" || error?.failure === "disabled";
  const empty = messages.length === 0 && !pending && !error;

  return (
    <>
      {/* Sticky in the bottom-right corner of every app page: the ZENOMARKETS glass tile with a small lime
          spark. On a phone terminal it sits above the pinned
          bar. While the panel is open the panel takes its place and the button steps out of the way. The tile grows a little
          on hover or focus, 200 ms, none under reduced motion. */}
      <button
        type="button"
        aria-label="Ask Zeno"
        aria-haspopup="dialog"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        title="Ask Zeno"
        onClick={openSheet}
        className={cn(
          "group fixed right-3 z-20 grid size-14 place-items-center rounded-[22%] transition-opacity duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg lg:bottom-6 lg:right-6",
          barBelow ? "bottom-20" : "bottom-4",
          open ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <Image src={mark} alt="" className="size-14 rounded-[22%] shadow-float transition-[scale] duration-200 ease-out group-hover:scale-110 group-focus-visible:scale-110" />
        <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute -right-1.5 -top-1.5 size-5 fill-accent drop-shadow-md">
          <path d={SPARK} />
        </svg>
        {unread ? <span aria-label="New answer" className="absolute -left-1 -top-1 size-3 rounded-full bg-accent ring-2 ring-ground" /> : null}
      </button>
      {mounted
        ? createPortal(
            <div
              ref={panel}
              tabIndex={-1}
              role="dialog"
              aria-label="Ask Zeno"
              className={cn(
                "fixed z-50 flex flex-col bg-surface shadow-float outline-none transition-[height,width,right,bottom,translate,opacity] duration-200 ease-out",
                full
                  ? "bottom-0 right-0 h-dvh w-screen lg:bottom-3 lg:right-3 lg:h-[calc(100dvh-1.5rem)] lg:w-[30rem] lg:rounded-panel lg:border lg:border-line"
                  : cn(
                      "right-3 h-[max(23rem,calc(100dvh/3))] w-[calc(100vw-1.5rem)] rounded-panel border border-line lg:bottom-6 lg:right-6 lg:h-[max(23rem,calc((100dvh-1.5rem)/3))] lg:w-[24rem]",
                      barBelow ? "bottom-20" : "bottom-4",
                    ),
                shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
              )}
            >
              <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar large />
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold leading-tight">Ask Zeno</h2>
                    <p className="truncate text-xs text-muted">{symbol ? `Reading ${symbol}-PERP` : "Any listed market"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  {empty ? null : (
                    <button type="button" aria-label="New chat" title="New chat" onClick={newChat} disabled={pending} className={cn(HEAD_BUTTON, "disabled:opacity-40")}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  )}
                  <button type="button" aria-label={full ? "Make Zeno smaller" : "Make Zeno bigger"} title={full ? "Smaller" : "Bigger"} aria-pressed={full} onClick={() => setFull((value) => !value)} className={HEAD_BUTTON}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      {full ? <path d="M10 4v6H4M14 20v-6h6" /> : <path d="M4 10V4h6M20 14v6h-6" />}
                    </svg>
                  </button>
                  <button type="button" aria-label="Minimize Zeno" title="Minimize" onClick={closeSheet} className={HEAD_BUTTON}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d="M5 12h14" />
                    </svg>
                  </button>
                </div>
              </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" aria-live="polite">
                {empty ? (
                  <div className={cn("flex min-h-full flex-col justify-center", full ? "gap-6 py-6" : "gap-2 py-0")}>
                    <div>
                      <p className={cn("flex items-center gap-2 font-display text-muted", full ? "text-xl" : "text-sm")}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("shrink-0 fill-accent-fg", full ? "size-5" : "size-4")}>
                          <path d={SPARK} />
                        </svg>
                        {full ? "Hello, I'm Zeno" : "Hello, I'm Zeno, your ZENOMARKETS assistant."}
                      </p>
                      <h3 className={cn("font-display font-semibold leading-tight", full ? "mt-1 text-3xl" : "mt-1 text-base")}>{symbol ? `What can I do for you on ${symbol} today?` : "What can I do for you today?"}</h3>
                      {full ? <p className="mt-3 text-sm text-muted">I&apos;m your personal assistant here at ZENOMARKETS. I read ZENOMARKETS&apos; own prices, charts and news, and I always tell you where a number came from. Ask me anything, big or small.</p> : null}
                    </div>
                    <div className="flex flex-col gap-2">
                      {suggestions(symbol || "this market").map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => ask(question)}
                          className={cn("flex min-h-11 w-full items-center justify-between gap-3 whitespace-normal rounded-panel bg-raised px-4 text-left text-sm transition-colors duration-150 hover:bg-accent-soft hover:text-accent-hover", full ? "py-3" : "py-1.5")}
                        >
                          {question}
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-6 pt-2">
                    {messages.map((message, index) =>
                      message.role === "user" ? (
                        <p key={index} className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-panel bg-raised px-4 py-2.5 text-sm">
                          {message.content}
                        </p>
                      ) : (
                        <div key={index} className="flex gap-3">
                          <Avatar />
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">{message.content}</p>
                            {message.sources?.length ? (
                              <>
                                <p className="mt-3 text-xs text-muted">Sources</p>
                                <ul className="mt-1 flex flex-wrap gap-1.5">
                                  {message.sources.map((source) => (
                                    <li key={`${source.tool}-${source.source}-${source.asOf}`} className="break-words rounded-control border border-line bg-raised px-2 py-1 text-xs text-muted">
                                      {source.source} · {fmtSourceTime(source.asOf)}
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ),
                    )}

                    {pending ? (
                      <div role="status" className="flex gap-3">
                        <Avatar />
                        <div className="min-w-0 flex-1 space-y-2.5 pt-1">
                          <p className="text-sm text-muted">Zeno is reading the market…</p>
                          <Skeleton className="block h-3 w-full" />
                          <Skeleton className="block h-3 w-5/6" />
                          <Skeleton className="block h-3 w-2/3" />
                        </div>
                      </div>
                    ) : null}

                    {error ? (
                      <div role="alert" className="flex flex-col items-start gap-2 rounded-panel border border-down bg-down-soft px-4 py-3 text-sm">
                        {isLimit(error.failure) ? <p className="font-medium">Limit reached</p> : null}
                        <p>{failureText(error.failure, error.retryAfterSeconds)}</p>
                        {stuck ? null : (
                          <Button variant="secondary" size="sm" onClick={() => void run(messages)} disabled={pending}>
                            Try again
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
                <div ref={end} />
              </div>

              <div className="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
                <form onSubmit={onSubmit} className={cn(fieldBorder, "flex items-end gap-2 border bg-raised py-1.5 pl-5 pr-1.5 transition-[border-radius] duration-150", tall ? "rounded-feature" : "rounded-full")}>
                  <label className="sr-only" htmlFor="zeno-ai-input">
                    Your question
                  </label>
                  <textarea
                    id="zeno-ai-input"
                    ref={field}
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onFieldKey}
                    maxLength={QUESTION_CHARS}
                    disabled={stuck}
                    autoComplete="off"
                    placeholder={stuck ? "Not available right now" : symbol ? `Ask about ${symbol}` : "Ask a question"}
                    className="min-h-[44px] min-w-0 flex-1 resize-none self-center bg-transparent py-2.5 text-base leading-6 outline-none placeholder:text-faint disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    aria-label="Ask"
                    disabled={stuck || pending || draft.trim() === ""}
                    className="grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-colors duration-150 hover:bg-accent-hover active:bg-accent-press disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                </form>
                <p className="mt-2 text-center text-xs text-muted">Zeno can make mistakes, not financial advice</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
