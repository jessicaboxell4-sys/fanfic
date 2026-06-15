import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import {
  ChevronDown,
  BookOpen,
  Flame,
  Trophy,
  Sparkles,
  Calendar as CalendarIcon,
  UserCircle2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

/* -------- Slide shell with reveal animation -------- */
function Slide({ id, bg, fg = "#FFFFFF", children, testid }) {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.45, once: false });
  return (
    <section
      ref={ref}
      id={id}
      data-testid={testid}
      className="snap-start h-screen w-full flex items-center justify-center px-6 py-12 relative overflow-hidden"
      style={{ background: bg, color: fg }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.06] mix-blend-overlay"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, #fff 0px, transparent 1px), radial-gradient(circle at 80% 60%, #fff 0px, transparent 1px), radial-gradient(circle at 40% 80%, #fff 0px, transparent 1px)",
          backgroundSize: "3px 3px",
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-3xl text-center"
      >
        {children}
      </motion.div>
    </section>
  );
}

function Stagger({ children, delay = 0.15 }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ amount: 0.4, once: false }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

function CountUp({ to, duration = 1.2, format = (n) => n }) {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.5, once: false });
  const target = Number(to) || 0;
  const [value, setValue] = useState(target);

  useEffect(() => {
    let raf;
    if (!inView || target === 0) {
      raf = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, target, duration]);

  return <span ref={ref}>{format(value)}</span>;
}

function WrappedBar({ label, value, max, accent, to, idx = 0 }) {
  const pct = max > 0 ? Math.max(8, (value / max) * 100) : 0;
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.5, once: false });
  const inner = (
    <div ref={ref} className="text-left">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-base md:text-lg font-medium opacity-95 truncate pr-3">
          <span className="opacity-70 mr-2 tabular-nums">{String(idx + 1).padStart(2, "0")}</span>
          {label}
        </span>
        <span className="text-base md:text-lg tabular-nums font-bold">{value}</span>
      </div>
      <div className="h-2.5 rounded-full bg-white/15 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: accent }}
          initial={{ width: 0 }}
          animate={inView ? { width: `${pct}%` } : { width: 0 }}
          transition={{ duration: 0.9, delay: 0.1 + idx * 0.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * Slides used by both the authenticated YearInBooksPage and the public
 * /share/yib/:token page. Sharing prevents the two surfaces from drifting
 * visually as we tweak the recap layout.
 *
 * Props:
 *   - summary, year, hasData, ownerName?(public only)
 *   - scrollRef:  React ref attached to the snap-scroll container
 *   - activeSlide: current slide index (for progress dots)
 *   - onScrollToSlide(idx): scroll to slide
 *   - footerCta: ReactNode rendered on the final slide
 */
export default function YearInBooksWrapped({
  summary,
  year,
  ownerName,
  scrollRef,
  activeSlide,
  onScrollToSlide,
  footerCta,
}) {
  const s = summary || {};
  const maxFandom = Math.max(0, ...(s.top_fandoms || []).map((f) => f.count));
  const maxAuthor = Math.max(0, ...(s.top_authors || []).map((a) => a.count));
  const maxMonthly = Math.max(1, ...(s.monthly || []).map((m) => m.opens));
  const totalSlides = 9;

  return (
    <>
      {/* Progress dots */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-2">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <button
            key={i}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => onScrollToSlide?.(i)}
            className="w-2 h-2 rounded-full transition-all"
            style={{
              background: activeSlide === i ? "#fff" : "rgba(255,255,255,0.35)",
              transform: activeSlide === i ? "scale(1.4)" : "scale(1)",
            }}
          />
        ))}
      </div>

      {/* Scroll hint */}
      {activeSlide === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: [0, 10, 0] }}
          transition={{ delay: 1.5, duration: 2, repeat: Infinity, repeatType: "loop" }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-40 text-white/80 text-xs uppercase tracking-[0.25em] flex flex-col items-center gap-2 pointer-events-none"
        >
          <span>Scroll</span>
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      )}

      {/* Slides */}
      <div
        ref={scrollRef}
        className="h-screen w-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
        data-testid="year-in-books-recap"
      >
        {/* 1. Cover */}
        <Slide
          id="slide-cover"
          bg="linear-gradient(135deg, #1B1240 0%, #3B1F7A 50%, #6B46C1 100%)"
        >
          <p className="text-xs md:text-sm font-bold uppercase tracking-[0.35em] opacity-80 mb-6">
            Shelfsort wrapped
          </p>
          <h1
            className="font-serif leading-[0.9] mb-4"
            style={{ fontSize: "clamp(5rem, 18vw, 12rem)" }}
            data-testid="year-in-books-title"
          >
            {year}
          </h1>
          <p className="font-serif italic opacity-95" style={{ fontSize: "clamp(1.5rem, 4vw, 2.5rem)" }}>
            {ownerName ? `${ownerName}'s year in books.` : "Your year in books."}
          </p>
        </Slide>

        {/* 2. Books opened */}
        <Slide
          id="slide-opened"
          bg="linear-gradient(135deg, #E07A5F 0%, #D4634A 60%, #B5503A 100%)"
          testid="year-headline-stats"
        >
          <Stagger>
            <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-6">
              {ownerName ? `${ownerName} opened` : "You opened"}
            </motion.p>
            <motion.div variants={fadeUp}>
              <p
                className="font-serif leading-none tabular-nums"
                style={{ fontSize: "clamp(7rem, 22vw, 16rem)" }}
              >
                <CountUp to={s.books_opened} />
              </p>
            </motion.div>
            <motion.p variants={fadeUp} className="font-serif text-3xl md:text-4xl italic mt-4 opacity-95">
              {s.books_opened === 1 ? "book" : "books"} this year.
            </motion.p>
            {s.books_finished > 0 && (
              <motion.p variants={fadeUp} className="text-base md:text-lg opacity-85 mt-8">
                {ownerName ? "And finished" : "You finished"}{" "}
                <strong className="font-bold">{s.books_finished}</strong> of them.
              </motion.p>
            )}
          </Stagger>
        </Slide>

        {/* 3. Pages read */}
        <Slide
          id="slide-pages"
          bg="linear-gradient(135deg, #B87A00 0%, #D49A1E 50%, #FFC857 100%)"
          fg="#2C1A00"
        >
          <Stagger>
            <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-80 mb-6">
              That&apos;s roughly
            </motion.p>
            <motion.div variants={fadeUp}>
              <p
                className="font-serif leading-none tabular-nums"
                style={{ fontSize: "clamp(5rem, 16vw, 12rem)" }}
              >
                <CountUp to={s.pages_read || 0} format={(n) => n.toLocaleString()} />
              </p>
            </motion.div>
            <motion.p variants={fadeUp} className="font-serif text-3xl md:text-4xl italic mt-4">
              pages turned.
            </motion.p>
            <motion.p variants={fadeUp} className="text-sm opacity-75 mt-6">
              ≈ {Math.max(1, Math.round((s.pages_read || 0) / 30))} hours of reading
            </motion.p>
          </Stagger>
        </Slide>

        {/* 4. Streak */}
        <Slide
          id="slide-streak"
          bg="linear-gradient(135deg, #1A3A52 0%, #2A6E8A 60%, #4FA3C7 100%)"
        >
          <Stagger>
            <motion.div variants={fadeUp} className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur flex items-center justify-center">
                <Flame className="w-8 h-8" />
              </div>
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-4">
              {ownerName ? "Longest streak" : "Your longest streak"}
            </motion.p>
            <motion.div variants={fadeUp}>
              <p
                className="font-serif leading-none tabular-nums"
                style={{ fontSize: "clamp(6rem, 20vw, 14rem)" }}
              >
                <CountUp to={s.longest_streak} />
              </p>
            </motion.div>
            <motion.p variants={fadeUp} className="font-serif text-3xl md:text-4xl italic mt-4 opacity-95">
              {s.longest_streak === 1 ? "day" : "days"} in a row.
            </motion.p>
            <motion.p variants={fadeUp} className="text-base md:text-lg opacity-85 mt-8">
              Active on <strong className="font-bold">{s.active_days}</strong> different days.
            </motion.p>
          </Stagger>
        </Slide>

        {/* 5. Best month + monthly bars */}
        <Slide
          id="slide-month"
          bg="linear-gradient(135deg, #6B46C1 0%, #8B5CF6 100%)"
          testid="year-monthly-chart"
        >
          <Stagger>
            <motion.div variants={fadeUp} className="flex justify-center mb-4">
              <CalendarIcon className="w-9 h-9 opacity-90" />
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-4">
              {ownerName ? `${ownerName}'s reading peak` : "Your reading peak"}
            </motion.p>
            {s.best_month && s.best_month.opens > 0 ? (
              <>
                <motion.p
                  variants={fadeUp}
                  className="font-serif leading-none"
                  style={{ fontSize: "clamp(3.5rem, 10vw, 7rem)" }}
                  data-testid="best-month-line"
                >
                  {s.best_month.name}
                </motion.p>
                <motion.p variants={fadeUp} className="font-serif text-2xl md:text-3xl italic mt-3 opacity-95">
                  {s.best_month.opens} book{s.best_month.opens === 1 ? "" : "s"} opened.
                </motion.p>
              </>
            ) : (
              <motion.p variants={fadeUp} className="font-serif text-3xl md:text-4xl italic">
                Spread across the year.
              </motion.p>
            )}

            <motion.div variants={fadeUp} className="mt-12 max-w-xl mx-auto">
              <div className="flex items-end gap-1.5 h-32">
                {(s.monthly || []).map((m) => {
                  const pct = (m.opens / maxMonthly) * 100;
                  return (
                    <div
                      key={m.month}
                      className="flex-1 flex flex-col items-center justify-end"
                      title={`${m.label}: ${m.opens} opens, ${m.finished} finished`}
                    >
                      <motion.div
                        className="w-full rounded-t"
                        initial={{ height: 0 }}
                        whileInView={{ height: `${Math.max(2, pct)}%` }}
                        viewport={{ amount: 0.5, once: false }}
                        transition={{ duration: 0.6, delay: m.month * 0.04, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                          background: m.opens > 0 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.18)",
                          minHeight: "3px",
                        }}
                      />
                      <span className="text-[10px] opacity-70 mt-1.5">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </Stagger>
        </Slide>

        {/* 6. Top fandoms */}
        {(s.top_fandoms || []).length > 0 && (
          <Slide
            id="slide-fandoms"
            bg="linear-gradient(135deg, #1F3D2B 0%, #3A5A40 60%, #588157 100%)"
            testid="year-top-fandoms"
          >
            <Stagger>
              <motion.div variants={fadeUp} className="flex justify-center mb-4">
                <Sparkles className="w-9 h-9 opacity-90" />
              </motion.div>
              <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-3">
                The worlds {ownerName ? `${ownerName} lived in` : "you lived in"}
              </motion.p>
              <motion.p variants={fadeUp} className="font-serif text-4xl md:text-5xl mb-2">
                {s.top_fandoms[0]?.name}
              </motion.p>
              <motion.p variants={fadeUp} className="font-serif text-2xl italic opacity-85 mb-10">
                topped the list with {s.top_fandoms[0]?.count} book{s.top_fandoms[0]?.count === 1 ? "" : "s"}.
              </motion.p>
              <motion.div variants={fadeUp} className="space-y-4 max-w-md mx-auto">
                {s.top_fandoms.slice(0, 5).map((f, i) => (
                  <WrappedBar
                    key={f.name}
                    label={f.name}
                    value={f.count}
                    max={maxFandom}
                    to={ownerName ? null : `/library/fandom/${encodeURIComponent(f.name)}`}
                    accent="#FFE08A"
                    idx={i}
                  />
                ))}
              </motion.div>
            </Stagger>
          </Slide>
        )}

        {/* 7. Top author */}
        {(s.top_authors || []).length > 0 && (
          <Slide
            id="slide-authors"
            bg="linear-gradient(135deg, #5B2A86 0%, #8E3FB0 50%, #C16EBF 100%)"
            testid="year-top-authors"
          >
            <Stagger>
              <motion.div variants={fadeUp} className="flex justify-center mb-4">
                <UserCircle2 className="w-9 h-9 opacity-90" />
              </motion.div>
              <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-4">
                The voice {ownerName ? `${ownerName} read most` : "you read most"}
              </motion.p>
              <motion.p
                variants={fadeUp}
                className="font-serif leading-tight"
                style={{ fontSize: "clamp(3rem, 9vw, 6rem)" }}
              >
                {s.top_authors[0]?.name}
              </motion.p>
              <motion.p variants={fadeUp} className="font-serif text-2xl italic opacity-90 mt-3">
                {s.top_authors[0]?.count} book{s.top_authors[0]?.count === 1 ? "" : "s"} this year.
              </motion.p>
              {s.top_authors.length > 1 && (
                <motion.div variants={fadeUp} className="mt-10 max-w-md mx-auto space-y-4">
                  {s.top_authors.slice(1, 5).map((a, i) => (
                    <WrappedBar
                      key={a.name}
                      label={a.name}
                      value={a.count}
                      max={maxAuthor}
                      to={ownerName ? null : `/library/author/${encodeURIComponent(a.name)}`}
                      accent="#FFD5F0"
                      idx={i + 1}
                    />
                  ))}
                </motion.div>
              )}
            </Stagger>
          </Slide>
        )}

        {/* 8. Bookends */}
        {(s.first_book || s.last_book) && (
          <Slide
            id="slide-bookends"
            bg="linear-gradient(135deg, #FDF3E1 0%, #F5D8A6 50%, #E0A857 100%)"
            fg="#2C2C2C"
            testid="year-bookends"
          >
            <Stagger>
              <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] mb-8" style={{ color: "#8B4F00" }}>
                Bookends
              </motion.p>
              <div className="grid sm:grid-cols-2 gap-8 text-left max-w-2xl mx-auto">
                {s.first_book && s.first_book.title && (
                  <motion.div variants={fadeUp}>
                    <p className="text-xs uppercase tracking-wider opacity-70 mb-2">First book of the year</p>
                    <p className="font-serif text-2xl md:text-3xl leading-tight">{s.first_book.title}</p>
                    <p className="text-sm opacity-70 mt-2">
                      {s.first_book.author} · {s.first_book.date}
                    </p>
                  </motion.div>
                )}
                {s.last_book &&
                  s.last_book.title &&
                  (!s.first_book || s.last_book.book_id !== s.first_book.book_id) && (
                    <motion.div variants={fadeUp}>
                      <p className="text-xs uppercase tracking-wider opacity-70 mb-2">Last book of the year</p>
                      <p className="font-serif text-2xl md:text-3xl leading-tight">{s.last_book.title}</p>
                      <p className="text-sm opacity-70 mt-2">
                        {s.last_book.author} · {s.last_book.date}
                      </p>
                    </motion.div>
                  )}
              </div>
            </Stagger>
          </Slide>
        )}

        {/* 9. Final */}
        <Slide
          id="slide-outro"
          bg="linear-gradient(135deg, #1B1240 0%, #3B1F7A 40%, #6B46C1 100%)"
        >
          <Stagger>
            <motion.div variants={fadeUp} className="flex justify-center mb-4">
              <Trophy className="w-9 h-9 opacity-90" />
            </motion.div>
            <motion.p variants={fadeUp} className="text-xs md:text-sm font-bold uppercase tracking-[0.3em] opacity-85 mb-3">
              That was {ownerName ? `${ownerName}'s` : "your"}
            </motion.p>
            <motion.p
              variants={fadeUp}
              className="font-serif leading-none"
              style={{ fontSize: "clamp(5rem, 14vw, 10rem)" }}
            >
              {year}.
            </motion.p>
            <motion.p variants={fadeUp} className="font-serif text-2xl md:text-3xl italic opacity-95 mt-4">
              See you next chapter.
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
              data-testid="year-achievements"
            >
              {s.longest_streak >= 7 && (
                <span className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur text-xs font-medium inline-flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5" /> On fire · {s.longest_streak}-day streak
                </span>
              )}
              {s.books_finished >= 10 && (
                <span className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur text-xs font-medium inline-flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" /> Finisher · {s.books_finished} closed
                </span>
              )}
              {(s.top_fandoms || []).length >= 3 && (
                <span className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur text-xs font-medium inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Eclectic · {s.top_fandoms.length}+ fandoms
                </span>
              )}
            </motion.div>

            {footerCta && (
              <motion.div variants={fadeUp} className="mt-10">
                {footerCta}
              </motion.div>
            )}
          </Stagger>
        </Slide>
      </div>
    </>
  );
}

/* Empty-state surface — single fullscreen card, calmer gradient. */
export function YearInBooksEmpty({ year, currentYear, onPrev, onLibraryLink = "/library", closeButton }) {
  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-6 py-12 relative"
      style={{ background: "linear-gradient(135deg, #1B1240 0%, #3B1F7A 50%, #6B46C1 100%)", color: "#fff" }}
    >
      {closeButton}
      <div className="text-center max-w-lg">
        <BookOpen className="w-14 h-14 mx-auto mb-6 opacity-80" />
        <p className="text-xs font-bold uppercase tracking-[0.3em] opacity-70 mb-4">Shelfsort wrapped</p>
        <h1
          className="font-serif leading-[0.95] mb-3"
          style={{ fontSize: "clamp(4rem, 11vw, 7rem)" }}
          data-testid="year-in-books-title"
        >
          {year}
        </h1>
        <h2 className="font-serif text-2xl md:text-3xl italic mb-8 opacity-90">A quiet year on the shelf.</h2>
        <p className="text-base opacity-80 mb-8">
          {year >= currentYear
            ? "The year isn't over yet — come back when it is, or peek at a previous year."
            : "No reading was recorded in this year. Try another, or head back to your library."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {onPrev && (
            <button
              onClick={onPrev}
              data-testid="prev-year"
              className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-medium backdrop-blur inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> {year - 1}
            </button>
          )}
          <Link
            to={onLibraryLink}
            className="px-5 py-2.5 rounded-full bg-white text-[#2C2C2C] text-sm font-semibold hover:bg-white/90 inline-flex items-center gap-2"
          >
            Open library <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
