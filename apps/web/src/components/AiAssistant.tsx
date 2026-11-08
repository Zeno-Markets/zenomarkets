"use client";

import { Button, cn, fieldBorder } from "@zeno/ui";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import mark from "@/assets/zeno-glass-mark.png";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useTerminal } from "@/stores/terminal";
import { AiError, askAi, failureText, fmtSourceTime, followUps, isLimit, revealParts, suggestions, type AiMessage } from "@/lib/ai";

const SPARK = "M12 2C12.8 8 16 11.2 22 12C16 12.8 12.8 16 12 22C11.2 16 8 12.8 2 12C8 11.2 11.2 8 12 2Z";

/// The ZENOMARKETS glass mark on its own, no tile behind it: the assistant's face beside each answer. The soft shade keeps
/// the lime glass readable on the light theme.
function Avatar({ large = false, busy = false }: { large?: boolean; busy?: boolean }) {
  return <Image src={mark} alt="" aria-hidden="true" className={cn("mt-0.5 shrink-0 drop-shadow-[0_2px_6px_rgb(0_0_0/0.3)]", large ? "size-8" : "size-6", busy && "animate-pulse")} />;
}

/// The panel's slide lasts this long.
const MOTION_MS = 200;

/// The question field grows with its text up to this height, then scrolls. The API keeps 2,000 characters a message.
const FIELD_MAX_PX = 160;
const QUESTION_CHARS = 2000;

/// The conversation is kept in this tab (sessionStorage), so a reload or a full page load does not lose it.
const SAVED = "zeno-ai-chat";
const SAVED_MESSAGES = 20;

/// The waiting row's words, one after another while the answer is on its way.
const THINKING = ["Thinking…", "Reading the data…", "Writing the answer…"];

const HEAD_BUTTON = "grid size-9 min-w-[44px] place-items-center rounded-full text-muted transition-colors duration-150 hover:bg-raised hover:text-text";
const CHIP = "min-h-[44px] rounded-full border border-line bg-raised px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:border-accent-line hover:bg-accent-soft";

function loadChat(): { symbol: string; messages: AiMessage[] } | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SAVED) ?? "null") as { symbol?: unknown; messages?: unknown } | null;
    if (!saved || !Array.isArray(saved.messages)) return undefined;
    const messages = (saved.messages as AiMessage[]).filter((message) => (message?.role === "user" || message?.role === "assistant") && typeof message.content === "string").slice(-SAVED_MESSAGES);
    // A question that was still waiting when the page went away has no answer coming.
    while (messages[messages.length - 1]?.role === "user") messages.pop();
    return messages.length ? { symbol: typeof saved.symbol === "string" ? saved.symbol : "", messages } : undefined;
  } catch {
    return undefined;
  }
}

/// A new answer appears a word at a time (about 1.5 s for a long one), with a caret at its end. Screen readers get the
/// whole text at once from the hidden copy beside it, so the live region is read once, not word by word.
function Typed({ text, onStep, onDone }: { text: string; onStep: () => void; onDone: () => void }) {
  const parts = useMemo(() => revealParts(text), [text]);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (count >= parts.length) {
      onDone();
      return;
    }
    const timer = setTimeout(() => {
      setCount((value) => value + Math.max(1, Math.ceil(parts.length / 50)));
      onStep();
    }, 30);
    return () => clearTimeout(timer);
    // The callbacks change on every render of the panel; only the reveal's own progress drives this.
  }, [count, parts.length]);
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {parts.slice(0, count).join("")}
        <span className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-0.5 animate-pulse bg-accent-fg" />
      </span>
    </>
  );
}

/// Bouncing dots and a few words that move on while the answer is on its way.
function Thinking() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, THINKING.length - 1)), 2200);
    return () => clearInterval(timer);
  }, []);
  return (
    <div role="status" className="flex items-center gap-3">
      <Avatar busy />
      <div className="flex items-center gap-2.5 text-sm text-muted">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1.5 animate-bounce rounded-full bg-accent-fg" style={{ animationDelay: `${dot * 150}ms` }} />
          ))}
        </span>
        <span>{THINKING[step]}</span>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy answer"}
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => undefined)}
      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-xs text-muted transition-colors duration-150 hover:bg-raised hover:text-text"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {copied ? <path d="M5 12l5 5L20 7" /> : <path d="M9 9h10v10H9zM5 15V5h10" />}
      </svg>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/// "Ask Zeno": a chat sheet, laid out like Gemini: a greeting and suggestion tiles when empty, the user's words in a
/// soft pill on the right, answers as plain text beside the assistant's face with source chips under them, and a rounded
/// input bar with a round send button. It explains the open market from ZENOMARKETS data and the product from the Docs
/// page. It only reads, so it works without a wallet (there is nothing here that signs or sends).
///
/// A new answer is revealed a word at a time; its sources, a copy button and up to three follow-up questions fade in when
/// it is done. While an answer is on its way the send button becomes Stop, which puts the question back in the field.
/// The conversation is kept for the tab, so a reload keeps it. Under reduced motion answers appear whole and nothing
/// bounces, slides or fades (globals.css).
///
/// It opens as the full panel (a full-height sheet on a phone, a tall card on a wide screen) and shrinks to a mini panel in
/// the bottom-right corner with the size button. The minimize button folds it back into the round button; the
/// conversation stays. The page stays usable behind it: only a shadow lifts the panel.
///
/// States: loading (the thinking row), empty (greeting and suggested questions), error and limit reached (a sentence
/// and a way on), success (the answer, its sources and what to ask next), and the line "Ask Zeno can make mistakes.
/// Check important info." which is always on screen.
export function AiAssistant() {
  // The market open in the terminal, if any; empty on a page that has none, and the assistant then answers about any market.
  const symbol = useTerminal((state) => state.symbol);
  // The two terminals pin a Long / Short (or option) bar to the bottom on a phone; the button rides above it.
  const barBelow = /^\/(perpetuals|options)/.test(usePathname());
  const reduced = useReducedMotion();
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
  // The index of the answer being revealed, if one is.
  const [typing, setTyping] = useState<number>();
  const request = useRef<AbortController>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // More than one line: the bar's corners soften so a tall field does not become a pill.
  const [tall, setTall] = useState(false);
  // Another market starts a fresh conversation. The market list arriving (empty symbol to NVDA) does not: a question asked
  // while it loads stays.
  const sameMarket = !chat.symbol || !symbol || chat.symbol === symbol;
  const messages = sameMarket ? chat.messages : [];

  // Read once after hydration (the server has no storage), then written on every change.
  useEffect(() => {
    const saved = loadChat();
    if (saved) setChat(saved);
  }, []);
  useEffect(() => {
    try {
      if (chat.messages.length) sessionStorage.setItem(SAVED, JSON.stringify({ symbol: chat.symbol, messages: chat.messages.slice(-SAVED_MESSAGES) }));
      else sessionStorage.removeItem(SAVED);
    } catch {
      // Storage blocked (a private window): the conversation just lasts as long as the page.
    }
  }, [chat]);

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
    setTyping(undefined);
    closing.current = setTimeout(() => setMounted(false), MOTION_MS);
  };
  useEffect(() => () => clearTimeout(closing.current), []);

  const lastSymbol = useRef(symbol);
  useEffect(() => {
    if (lastSymbol.current && symbol && lastSymbol.current !== symbol) {
      setError(undefined);
      setDraft("");
      setTyping(undefined);
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
  }, [messages.length, pending, error, typing]);
  // While an answer is revealed the thread follows it, unless the reader has scrolled up to read something else.
  const follow = () => {
    const box = scroller.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 120) end.current?.scrollIntoView({ block: "end" });
  };

  async function run(thread: AiMessage[]) {
    const controller = new AbortController();
    request.current = controller;
    setChat({ symbol, messages: thread });
    setPending(true);
    setError(undefined);
    setTyping(undefined);
    try {
      const { answer, sources } = await askAi(symbol, thread, controller.signal);
      setChat((current) => {
        if (current.symbol && symbol && current.symbol !== symbol) return current;
        // Reveal it word by word only when someone is watching and motion is welcome.
        if (openRef.current && !reduced) setTyping(current.messages.length);
        return { symbol: current.symbol || symbol, messages: [...current.messages, { role: "assistant", content: answer, sources }] };
      });
      if (!openRef.current) setUnread(true);
    } catch (caught) {
      if (controller.signal.aborted) {
        // Stopped: the question goes back in the field, ready to change or send again.
        const last = thread[thread.length - 1];
        setChat({ symbol, messages: thread.slice(0, -1) });
        if (last?.role === "user") setDraft(last.content);
        field.current?.focus();
        return;
      }
      setError(caught instanceof AiError ? caught : new AiError("unavailable"));
    } finally {
      if (request.current === controller) request.current = undefined;
      setPending(false);
    }
  }
  const stop = () => request.current?.abort();
  useEffect(() => () => request.current?.abort(), []);

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
    setTyping(undefined);
    field.current?.focus();
  };

  // A day's limit or a switched-off assistant will not clear by trying again, so there is no retry or input for them.
  const stuck = error?.failure === "daily_limit" || error?.failure === "disabled";
  const empty = messages.length === 0 && !pending && !error;
  const lastAnswer = messages.length - 1;
  const asked = messages.filter((message) => message.role === "user").map((message) => message.content);

  return (
    <>
      {/* Sticky in the bottom-right corner of every app page: the ZENOMARKETS glass mark, no tile behind it, with a small
          lime spark. On a wide screen a label slides out of it on hover or focus. On a phone terminal it sits above the
          pinned bar. While the panel is open the panel takes its place and the button steps out of the way. */}
      <button
        type="button"
        aria-label="Ask Zeno"
        aria-haspopup="dialog"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        onClick={openSheet}
        className={cn(
          "group fixed right-3 z-20 flex h-14 items-center rounded-full transition-opacity duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg lg:bottom-6 lg:right-6",
          barBelow ? "bottom-20" : "bottom-4",
          open ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        <span className="mr-1 hidden max-w-0 overflow-hidden whitespace-nowrap rounded-full bg-raised py-2 text-sm font-medium opacity-0 shadow-float transition-[max-width,padding,opacity] duration-200 ease-out group-hover:max-w-32 group-hover:px-3.5 group-hover:opacity-100 group-focus-visible:max-w-32 group-focus-visible:px-3.5 group-focus-visible:opacity-100 lg:block">
          Ask Zeno
        </span>
        <span className="relative grid size-14 place-items-center">
          <Image src={mark} alt="" priority className="size-12 drop-shadow-[0_6px_14px_rgb(0_0_0/0.35)] transition-[scale,rotate] duration-200 ease-out group-hover:-rotate-6 group-hover:scale-110 group-focus-visible:scale-110" />
          <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute -right-0.5 top-0 size-4 fill-accent drop-shadow-md">
            <path d={SPARK} />
          </svg>
          {unread ? <span aria-label="New answer" className="absolute left-0 top-0.5 size-3 animate-pulse rounded-full bg-accent ring-2 ring-ground" /> : null}
        </span>
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
                  <Avatar large busy={pending} />
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

              <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 pb-3" aria-live="polite">
                {empty ? (
                  <div className={cn("flex min-h-full flex-col justify-center", full ? "gap-6 py-6" : "gap-2 py-0")}>
                    <div className="ai-in">
                      <p className={cn("flex items-center gap-2 font-display text-muted", full ? "text-xl" : "text-sm")}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("shrink-0 fill-accent-fg", full ? "size-5" : "size-4")}>
                          <path d={SPARK} />
                        </svg>
                        {full ? "Hello, I'm Zeno" : "Hello, I'm Zeno, your ZENOMARKETS assistant."}
                      </p>
                      <h3 className={cn("font-display font-semibold leading-tight", full ? "mt-1 text-3xl" : "mt-1 text-base")}>{symbol ? `What can I do for you on ${symbol} today?` : "What can I do for you today?"}</h3>
                      {full ? <p className="mt-3 text-sm text-muted">I&apos;m your personal assistant here at ZENOMARKETS. I read ZENOMARKETS&apos; own prices, charts, news and docs, and I always tell you where a number came from. Ask me anything, big or small.</p> : null}
                    </div>
                    <div className={cn("grid gap-2", full && "sm:grid-cols-2")}>
                      {suggestions(symbol || undefined)
                        .slice(0, full ? 4 : 3)
                        .map((question, index) => (
                          <button
                            key={question}
                            type="button"
                            onClick={() => ask(question)}
                            style={{ animationDelay: `${80 + index * 60}ms` }}
                            className={cn(
                              "ai-in group/tile flex min-h-[44px] w-full items-center justify-between gap-3 whitespace-normal rounded-panel border border-transparent bg-raised px-4 text-left text-sm transition-[background-color,border-color,translate] duration-150 hover:-translate-y-0.5 hover:border-accent-line hover:bg-accent-soft",
                              full ? "py-3" : "py-1.5",
                            )}
                          >
                            {question}
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover/tile:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
                        <p key={index} className="ai-in ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-panel bg-raised px-4 py-2.5 text-sm">
                          {message.content}
                        </p>
                      ) : (
                        <div key={index} className="flex gap-3">
                          <Avatar />
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed">
                              {typing === index ? <Typed text={message.content} onStep={follow} onDone={() => setTyping(undefined)} /> : message.content}
                            </p>
                            {typing === index ? null : (
                              <div className="ai-in">
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
                                <div className="-ml-3 mt-1">
                                  <CopyButton text={message.content} />
                                </div>
                                {index === lastAnswer && !pending && !error ? (
                                  <div className="mt-1 flex flex-wrap gap-2" aria-label="Ask next">
                                    {followUps(symbol || undefined, asked).map((question) => (
                                      <button key={question} type="button" onClick={() => ask(question)} className={CHIP}>
                                        {question}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>
                      ),
                    )}

                    {pending ? <Thinking /> : null}

                    {error ? (
                      <div role="alert" className="ai-in flex flex-col items-start gap-2 rounded-panel border border-down bg-down-soft px-4 py-3 text-sm">
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
                <form onSubmit={onSubmit} className={cn(fieldBorder, "flex items-end gap-2 border bg-raised py-1.5 pl-5 pr-1.5 transition-[border-radius] duration-150 focus-within:border-accent-line", tall ? "rounded-feature" : "rounded-full")}>
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
                  {/* Separate keys: one reused <button> would turn into the submit button mid-click and send the question again. */}
                  {pending ? (
                    <button
                      key="stop"
                      type="button"
                      aria-label="Stop"
                      title="Stop"
                      onClick={stop}
                      className="grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full bg-text text-ground transition-opacity duration-150 hover:opacity-85"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      key="ask"
                      type="submit"
                      aria-label="Ask"
                      disabled={stuck || draft.trim() === ""}
                      className="grid size-11 min-h-[44px] min-w-[44px] shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition-[background-color,scale] duration-150 hover:bg-accent-hover active:scale-95 active:bg-accent-press disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 19V5M5 12l7-7 7 7" />
                      </svg>
                    </button>
                  )}
                </form>
                <p className="mt-2 text-center text-xs text-muted">Ask Zeno can make mistakes. Check important info.</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
