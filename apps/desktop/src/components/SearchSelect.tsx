// 検索式プルダウン（インクリメンタル検索 + 一覧選択の両対応）
import { useEffect, useRef, useState } from "react";
import { searchEntries, type NameEntry } from "../lib/names";

interface Props {
  entries: NameEntry[];
  value: string; // 英語名(Showdown表記)。未選択は ""
  onChange: (en: string) => void;
  placeholder: string;
  /** 選択済み値の表示名を返す */
  display: (en: string) => string;
  limit?: number;
}

export function SearchSelect({ entries, value, onChange, placeholder, display, limit = 14 }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = open ? searchEntries(entries, query, limit) : [];

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const select = (en: string) => {
    onChange(en);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && options[highlight]) {
      e.preventDefault();
      select(options[highlight].en);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="search-select" ref={rootRef}>
      <input
        type="text"
        value={open ? query : value ? display(value) : ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      <span className="caret">▾</span>
      {open && options.length > 0 && (
        <ul className="options">
          {options.map((opt, i) => (
            <li
              key={opt.en}
              className={i === highlight ? "highlight" : ""}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(opt.en);
              }}
            >
              {opt.ja}
              {opt.ja !== opt.en && <span className="en-sub">{opt.en}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
