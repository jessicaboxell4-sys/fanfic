import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Tag as TagIcon, Loader2 } from "lucide-react";

const normalize = (s) =>
  (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 32);

/**
 * TagInput — chip-style multi-tag input with autocomplete.
 *
 * Props:
 *  - value: string[]           current tags (lowercase slugs)
 *  - onChange(next: string[])  called when tags change
 *  - suggestions: string[]     pool of existing tags for autocomplete (optional)
 *  - placeholder: string
 *  - busy: bool                disables interaction (shows spinner)
 *  - testIdPrefix: string      e.g. "book-tags" — produces tag-chip, tag-input, tag-suggestion-X testids
 */
export default function TagInput({
  value = [],
  onChange,
  suggestions = [],
  placeholder = "Add tag…",
  busy = false,
  testIdPrefix = "tag",
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const inputRef = useRef(null);

  const lower = text.toLowerCase();
  const filteredSuggestions = suggestions
    .filter((s) => s && !value.includes(s))
    .filter((s) => !lower || s.toLowerCase().includes(lower))
    .slice(0, 8);

  const commit = useCallback(
    (raw) => {
      const t = normalize(raw);
      if (!t) return;
      if (value.includes(t)) {
        setText("");
        return;
      }
      onChange([...value, t]);
      setText("");
      setHoverIdx(0);
    },
    [onChange, value],
  );

  const removeAt = (i) => onChange(value.filter((_, idx) => idx !== i));

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (focused && filteredSuggestions[hoverIdx]) {
        commit(filteredSuggestions[hoverIdx]);
      } else {
        commit(text);
      }
    } else if (e.key === "Backspace" && !text && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHoverIdx((i) => Math.min(filteredSuggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHoverIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Escape") {
      setText("");
      setFocused(false);
    }
  };

  return (
    <div className="relative" data-testid={`${testIdPrefix}-input-container`}>
      <div
        className={`min-h-[44px] w-full bg-white border border-[#E8E6E1] rounded-xl px-2 py-1.5 flex flex-wrap gap-1.5 items-center transition-colors ${
          focused ? "border-[#E07A5F] ring-2 ring-[#E07A5F]/20" : ""
        } ${busy ? "opacity-60 pointer-events-none" : ""}`}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t, i) => (
          <span
            key={t}
            data-testid={`${testIdPrefix}-chip-${t}`}
            className="inline-flex items-center gap-1 bg-[#FDF3E1] text-[#B87A00] text-xs px-2 py-1 rounded-full font-semibold"
          >
            <TagIcon className="w-3 h-3" />
            {t}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeAt(i);
              }}
              data-testid={`${testIdPrefix}-remove-${t}`}
              className="hover:text-[#a76900] ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          data-testid={`${testIdPrefix}-input`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHoverIdx(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={value.length ? "" : placeholder}
          className="flex-1 min-w-[120px] bg-transparent text-sm outline-none px-2 py-1"
        />
        {busy && <Loader2 className="w-4 h-4 animate-spin text-[#6B705C] mr-1" />}
      </div>

      {focused && filteredSuggestions.length > 0 && (
        <div
          className="absolute z-30 top-full left-0 right-0 mt-1 bg-white border border-[#E8E6E1] rounded-xl shadow-lg py-1 max-h-56 overflow-y-auto"
          data-testid={`${testIdPrefix}-suggestions`}
        >
          {filteredSuggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                commit(s);
              }}
              onMouseEnter={() => setHoverIdx(i)}
              data-testid={`${testIdPrefix}-suggestion-${s}`}
              className={`block w-full text-left px-3 py-1.5 text-sm ${
                i === hoverIdx ? "bg-[#FDF3E1] text-[#2C2C2C]" : "text-[#2C2C2C] hover:bg-[#F5F3EC]"
              }`}
            >
              <TagIcon className="w-3 h-3 inline mr-1.5 text-[#B87A00]" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
