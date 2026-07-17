// ダメージをHPバーで表現する（3プリセットを横長バー3本・縦並び）
//
// 各バー: 左から残りHP、右からダメージが削れる。
//   明るい色 = 最大乱数後も確実に残るHP
//   薄い色 = 乱数によって残る可能性があるHP
import type { DirectionResult } from "../lib/calc";

function barColor(remainPercent: number): string {
  if (remainPercent > 50) return "linear-gradient(90deg, #21c48d, #7ee787)";
  if (remainPercent > 20) return "linear-gradient(90deg, #eab308, #fde047)";
  return "linear-gradient(90deg, #ef4444, #fb923c)";
}

function HorizontalHpBar({ label, minPercent, maxPercent, koText }: {
  label: string;
  minPercent: number;
  maxPercent: number;
  koText: string;
}) {
  const minRemain = Math.max(0, 100 - maxPercent);
  const maxRemain = Math.max(0, 100 - minPercent);
  const guaranteedDamage = Math.min(100, minPercent);
  const isOhko = minPercent >= 100;

  return (
    <div className="hp-bar-row">
      <span className="hp-bar-label">{label}</span>
      <div
        className={`hp-bar-track${isOhko ? " ko" : ""}`}
        aria-label={`${label}: ${minPercent.toFixed(1)}〜${maxPercent.toFixed(1)}%`}
      >
        {/* 左: 最大乱数でも確実に残るHP */}
        <div
          className="hp-bar-remain"
          style={{
            width: `${minRemain}%`,
            background: barColor(minRemain),
          }}
        />
        {/* 中: 乱数によって残る可能性があるHP */}
        <div
          className="hp-bar-range"
          style={{
            width: `${maxRemain - minRemain}%`,
            background: barColor(maxRemain),
          }}
        />
        {/* 右: 最小ダメージでも確実に削られるHP */}
        <div
          className="hp-bar-damage"
          style={{ width: `${guaranteedDamage}%` }}
        />
      </div>
      <span className="hp-bar-damage-text">
        {minPercent.toFixed(1)}〜{maxPercent.toFixed(1)}%
      </span>
      <span className="hp-bar-ko">{koText}</span>
    </div>
  );
}

export function HpBars({ result }: { result: DirectionResult }) {
  if (result.error) {
    return <div className="hp-bars muted">{result.error}</div>;
  }
  return (
    <div className="hp-bars">
      {result.presets.map((p) => (
        <HorizontalHpBar key={p.label} {...p} />
      ))}
    </div>
  );
}
