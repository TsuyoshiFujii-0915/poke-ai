// 対面ダメージ計算パネル
//
// 実際の対戦画面に合わせ、自分=左 / 相手=右 に配置する。
// HPバーは防御側（HPが減る側）のポケモンに隣接させる:
//   上段 = 自分の攻撃 → 相手の残りHP（右の相手カラムに隣接）
//   下段 = 相手の攻撃 → 自分の残りHP（左の自分カラムに隣接）
// 技は攻撃方向に固有なので、各段の攻撃側の端に置く。
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  calcMyAttack,
  calcOpponentAttack,
  speedTiers,
  type MySideConfig,
  type NatureStatKey,
  type OpponentConfig,
} from "../lib/calc";
import { getArtworkId, getBaseSpeed, getLearnset, itemEntries, moveEntries, speciesEntries } from "../lib/dex";
import { jaItem, jaMove, jaSpecies, type NameEntry } from "../lib/names";
import { normalizePointInput } from "../lib/point-input";
import {
  STAT_STAGE_KEYS,
  adjustStatStage,
  createNeutralStatStages,
  type StatStageKey,
  type StatStages,
} from "../lib/stat-stage";
import { usePokemonDetection } from "../lib/use-pokemon-detection";
import { HpBars } from "./HpBars";
import { SearchSelect } from "./SearchSelect";

/**
 * 技セレクタの候補: 習得技を先頭に、それ以外のチャンピオンズ実装技を後ろに並べる。
 * ハードフィルタにしないのは、生成データの鮮度ずれ（新レギュレーション直後等）でも
 * 入力がブロックされないようにするため（手動補正ファースト）。
 */
function useMoveCandidates(species: string): NameEntry[] {
  return useMemo(() => {
    const all = moveEntries();
    const learnset = species ? getLearnset(species) : null;
    if (!learnset) return all;
    const learned = new Set(learnset);
    return [...all.filter((e) => learned.has(e.en)), ...all.filter((e) => !learned.has(e.en))];
  }, [species]);
}

/** モンスターボールのラインアイコン（色は親のcurrentColorに従う） */
function BallIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" />
      <path d="M2.5 12h6" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 12h6" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/**
 * アイコン付き入力行。アイコンが項目種別（ボール=ポケモン、@=持ち物）と
 * 自分/相手（色）を同時に表すため、テキストラベルは置かない。
 */
function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="input-row">
      <span className="row-icon">{icon}</span>
      {children}
    </div>
  );
}

/** Renders mirrored official artwork and a base Speed badge for either battle side. */
function PokemonArt({ species, side }: { species: string; side: "mine" | "opp" }) {
  const artworkId = species ? getArtworkId(species) : null;
  const baseSpeed = species ? getBaseSpeed(species) : null;
  return (
    <div className={`poke-art ${side}`}>
      {artworkId ? (
        <img
          src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${artworkId}.png`}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="poke-art-placeholder" aria-hidden="true">?</span>
      )}
      {baseSpeed !== null && (
        <span className="speed-badge" title="S種族値">
          <span className="stat-letter">S</span>
          {baseSpeed}
        </span>
      )}
    </div>
  );
}

/** Renders the opponent's uninvested, neutral-max, and positive-max Speed tiers. */
function SpeedTiersLine({ species }: { species: string }) {
  const baseSpeed = species ? getBaseSpeed(species) : null;
  if (baseSpeed === null) return null;
  const tiers = speedTiers(baseSpeed);
  const cells: Array<[string, number]> = [
    ["0", tiers.noInvest],
    ["+32", tiers.semi],
    ["MAX", tiers.max],
  ];
  return (
    <div className="speed-line" title="素早さ実数値の目安（Lv50・IV31）: 無振り / 準速 / 最速">
      <span className="spe-label">SPEED</span>
      {cells.map(([label, value], i) => (
        <span key={label} className="tier-group">
          {i > 0 && <span className="slash" aria-hidden="true">/</span>}
          <span className="tier">
            <em>{label}</em>
            <b>{value}</b>
          </span>
        </span>
      ))}
    </div>
  );
}

const POINT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
type PointKey = (typeof POINT_KEYS)[number];
const POINT_LABELS = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D", spe: "S" } as const;
const STAGE_LABELS: Record<StatStageKey, string> = {
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};
const STAGE_NAMES: Record<StatStageKey, string> = {
  atk: "攻撃",
  def: "防御",
  spa: "特攻",
  spd: "特防",
  spe: "素早さ",
};

/** 数値入力フォーカス時に出すクイック選択肢 */
const QUICK_POINT_VALUES = [0, 32] as const;

/** PointsInputが更新する自分側設定の部分集合 */
type PointsPatch = Pick<MySideConfig, "points" | "plusStat" | "minusStat">;

/**
 * 自分側の能力ポイント入力（各0〜32、合計66をUIで強制）。
 * - 数値の上下の▲▼で性格補正を指定する（▲=1.1倍、▼=0.9倍。HPは対象外）。
 *   ▲と▼はそれぞれ同時に1つだけ（実際の性格仕様に合わせる）。
 * - 数値入力にフォーカスすると 0 / 32 のクイック選択メニューを下に出す。
 */
function PointsInput({ me, onChange }: {
  me: MySideConfig;
  onChange: (patch: PointsPatch) => void;
}) {
  const [focusedKey, setFocusedKey] = useState<PointKey | null>(null);
  const total = POINT_KEYS.reduce((sum, key) => sum + (me.points[key] ?? 0), 0);
  const set = (key: PointKey, rawValue: number): void => {
    const withoutCurrent = total - (me.points[key] ?? 0);
    const value = Math.max(0, Math.min(32, 66 - withoutCurrent, rawValue));
    onChange({ points: { ...me.points, [key]: value }, plusStat: me.plusStat, minusStat: me.minusStat });
  };

  const toggleMod = (key: NatureStatKey, dir: "plus" | "minus") => {
    let plusStat = me.plusStat;
    let minusStat = me.minusStat;
    if (dir === "plus") {
      plusStat = me.plusStat === key ? undefined : key;
      if (plusStat !== undefined && minusStat === key) minusStat = undefined;
    } else {
      minusStat = me.minusStat === key ? undefined : key;
      if (minusStat !== undefined && plusStat === key) plusStat = undefined;
    }
    onChange({ points: me.points, plusStat, minusStat });
  };

  const modArrow = (key: PointKey, dir: "plus" | "minus") => {
    const glyph = dir === "plus" ? "▲" : "▼";
    if (key === "hp") {
      // HPは性格補正対象外。桁を揃えるための不可視プレースホルダー
      return <span className="mod-arrow placeholder" aria-hidden="true">{glyph}</span>;
    }
    const active = (dir === "plus" ? me.plusStat : me.minusStat) === key;
    return (
      <button
        type="button"
        className={`mod-arrow ${dir === "plus" ? "up" : "down"} ${active ? "active" : ""}`}
        title={dir === "plus" ? "性格補正↑（1.1倍）" : "性格補正↓（0.9倍）"}
        onClick={() => toggleMod(key, dir)}
      >
        {glyph}
      </button>
    );
  };

  return (
    <div className="points-input" title="能力ポイント（各0〜32、合計66）。▲▼で性格補正（1.1倍/0.9倍）">
      {POINT_KEYS.map((key) => (
        <div key={key} className={`points-cell ${me.points[key] ? "active" : ""}`}>
          <span className="stat-letter">{POINT_LABELS[key]}</span>
          {modArrow(key, "plus")}
          <input
            type="number"
            min={0}
            max={32}
            value={me.points[key] ?? 0}
            onChange={(event) => {
              const normalized = normalizePointInput(event.currentTarget.value);
              event.currentTarget.value = normalized;
              set(key, Number(normalized));
            }}
            onFocus={(e) => {
              setFocusedKey(key);
              e.target.select();
            }}
            onBlur={() => setFocusedKey((k) => (k === key ? null : k))}
          />
          {modArrow(key, "minus")}
          {focusedKey === key && (
            <div className="points-quick">
              {QUICK_POINT_VALUES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onMouseDown={(e) => {
                    // 入力のblurより先に発火させ、フォーカスを保ったまま値を設定する
                    e.preventDefault();
                    set(key, value);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <span className={`points-total ${total === 66 ? "full" : ""}`}>
        <span className="stat-letter">計</span>
        {total}
      </span>
    </div>
  );
}

function formatStatStage(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function StatStageInput({
  side,
  stages,
  onChange,
}: {
  side: "mine" | "opp";
  stages: StatStages;
  onChange: (stages: StatStages) => void;
}): ReactNode {
  return (
    <div className={`stat-stages ${side}`} aria-label="能力ランク">
      {STAT_STAGE_KEYS.map((key) => (
        <div key={key} className={`stat-stage-cell ${stages[key] === 0 ? "" : "active"}`}>
          <span className="stat-stage-label" title={STAGE_NAMES[key]}>{STAGE_LABELS[key]}</span>
          <button
            type="button"
            className="stat-stage-button up"
            disabled={stages[key] === 6}
            aria-label={`${STAGE_NAMES[key]}ランクを上げる`}
            onClick={() => onChange(adjustStatStage(stages, key, 1))}
          >
            ▲
          </button>
          <span className={`stat-stage-value ${stages[key] > 0 ? "positive" : stages[key] < 0 ? "negative" : ""}`}>
            {formatStatStage(stages[key])}
          </span>
          <button
            type="button"
            className="stat-stage-button down"
            disabled={stages[key] === -6}
            aria-label={`${STAGE_NAMES[key]}ランクを下げる`}
            onClick={() => onChange(adjustStatStage(stages, key, -1))}
          >
            ▼
          </button>
        </div>
      ))}
    </div>
  );
}

export function MatchupPanel() {
  const [me, setMe] = useState<MySideConfig>({
    species: "",
    item: "",
    move: "",
    points: { hp: 32, atk: 32, spe: 2 },
    stages: createNeutralStatStages(),
  });
  const [opp, setOpp] = useState<OpponentConfig>({
    species: "",
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  });
  const detection = usePokemonDetection();

  useEffect(() => {
    setMe((current) => {
      if (current.species === detection.selection.player) return current;
      return { ...current, species: detection.selection.player, move: "" };
    });
  }, [detection.selection.player]);

  useEffect(() => {
    setOpp((current) => {
      if (current.species === detection.selection.opponent) return current;
      return { ...current, species: detection.selection.opponent, move: "" };
    });
  }, [detection.selection.opponent]);

  const myMoves = useMoveCandidates(me.species);
  const oppMoves = useMoveCandidates(opp.species);

  const myAttack = useMemo(() => calcMyAttack(me, opp), [me, opp]);
  const oppAttack = useMemo(() => calcOpponentAttack(me, opp), [me, opp]);

  return (
    <div className="matchup-panel">
      <div className="detection-mode-control" aria-label="ポケモン名の検出モード">
        <span className="detection-mode-label">AUTO</span>
        <button
          type="button"
          role="switch"
          aria-checked={detection.selection.mode === "auto"}
          aria-label="画面からポケモン名を自動検出"
          className={`detection-auto-switch ${detection.selection.mode === "auto" ? "active" : ""}`}
          disabled={detection.changingMode || !detection.synchronized}
          title={detection.selection.mode === "auto" ? "自動検出中" : "自動検出停止中"}
          onClick={() => void detection.changeMode(
            detection.selection.mode === "auto" ? "manual" : "auto",
          )}
        />
        {detection.error && (
          <span
            className="detection-error"
            title={detection.error}
            aria-label={detection.error}
          >
            !
          </span>
        )}
      </div>
      {/* 左: 自分のポケモン。相手側と高さが対角対応するよう
          ポケモン名・持ち物を上、公式絵を中、能力ポイントを下に置く */}
      <div className="side-col mine">
        <div className="side-fields">
          <IconRow icon={<BallIcon />}>
            <SearchSelect
              entries={speciesEntries()}
              value={me.species}
              onChange={(species) => detection.selectPokemon("player", species)}
              placeholder="自分のポケモン"
              display={jaSpecies}
              disabled={false}
            />
          </IconRow>
          <IconRow icon="@">
            <SearchSelect
              entries={itemEntries()}
              value={me.item ?? ""}
              onChange={(item) => setMe({ ...me, item })}
              placeholder="持ち物なし"
              display={jaItem}
              disabled={false}
            />
          </IconRow>
        </div>
        <StatStageInput
          side="mine"
          stages={me.stages}
          onChange={(stages) => setMe((current) => ({ ...current, stages }))}
        />
        <PokemonArt species={me.species} side="mine" />
        <PointsInput me={me} onChange={(patch) => setMe({ ...me, ...patch })} />
      </div>

      {/* 中央上段: 自分の攻撃 → 相手の残りHP */}
      <div className="attack-col">
        <div className="attack-row mine">
          <SearchSelect
            entries={myMoves}
            value={me.move ?? ""}
            onChange={(move) => setMe({ ...me, move })}
            placeholder="自分の技"
            display={jaMove}
            disabled={false}
          />
          <HpBars result={myAttack} />
        </div>

        <div className="vs-divider" aria-hidden="true">
          <span className="vs-badge">VS</span>
        </div>

        {/* 中央下段: 相手の攻撃 → 自分の残りHP */}
        <div className="attack-row opp">
          <HpBars result={oppAttack} />
          <SearchSelect
            entries={oppMoves}
            value={opp.move ?? ""}
            onChange={(move) => setOpp({ ...opp, move })}
            placeholder="相手の技"
            display={jaMove}
            disabled={false}
          />
        </div>
      </div>

      {/* Opponent artwork followed by Speed tiers, species, and held item. */}
      <div className="side-col opp">
        <PokemonArt species={opp.species} side="opp" />
        <StatStageInput
          side="opp"
          stages={opp.stages}
          onChange={(stages) => setOpp((current) => ({ ...current, stages }))}
        />
        <SpeedTiersLine species={opp.species} />
        <div className="side-fields">
          <IconRow icon={<BallIcon />}>
            <SearchSelect
              entries={speciesEntries()}
              value={opp.species}
              onChange={(species) => detection.selectPokemon("opponent", species)}
              placeholder="相手のポケモン"
              display={jaSpecies}
              disabled={false}
            />
          </IconRow>
          <IconRow icon="@">
            <SearchSelect
              entries={itemEntries()}
              value={opp.item ?? ""}
              onChange={(item) => setOpp({ ...opp, item })}
              placeholder="持ち物なし"
              display={jaItem}
              disabled={false}
            />
          </IconRow>
        </div>
      </div>
    </div>
  );
}
