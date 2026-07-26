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
  damageStageKeysForMove,
  speedTiers,
  type MySideConfig,
  type NatureStatKey,
  type OpponentConfig,
} from "../lib/calc";
import {
  abilityEntries,
  getAbilityNames,
  getArtworkId,
  getBaseSpeed,
  getLearnset,
  itemEntries,
  moveEntries,
  speciesEntries,
} from "../lib/dex";
import { reconcileAbilitySelection } from "../lib/ability-selection";
import { jaAbility, jaItem, jaMove, jaSpecies, type NameEntry } from "../lib/names";
import { normalizePointInput } from "../lib/point-input";
import {
  adjustStatStage,
  createNeutralStatStages,
  type StatStages,
} from "../lib/stat-stage";
import type { DamageStageKey } from "../lib/damage-stage";
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

function useAbilityCandidates(species: string): NameEntry[] {
  return useMemo(() => abilityEntries(species), [species]);
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

/** 特性を表す、既存入力アイコンと同じ線幅の分岐シンボル */
function AbilityIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="m10.3 11-3.1-1.8m6.5 1.8 3.1-1.8M12 14v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
const DAMAGE_STAGE_LABELS: Record<DamageStageKey, string> = {
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
};
const DAMAGE_STAGE_NAMES: Record<DamageStageKey, string> = {
  atk: "攻撃",
  def: "防御",
  spa: "特攻",
  spd: "特防",
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

function DamageStageCounter({
  stageKey,
  tone,
  roleName,
  stages,
  onChange,
}: {
  stageKey: DamageStageKey | null;
  tone: "mine" | "opp";
  roleName: "攻撃側" | "防御側";
  stages: StatStages;
  onChange: (stages: StatStages) => void;
}): ReactNode {
  if (stageKey === null) {
    return <div className="damage-stage-counter placeholder" aria-hidden="true" />;
  }
  const stage = stages[stageKey];
  return (
    <div
      className={`damage-stage-counter ${tone} ${stage === 0 ? "" : "active"}`}
      aria-label={`${roleName}の${DAMAGE_STAGE_NAMES[stageKey]}ランク`}
    >
      <span className="damage-stage-label">{DAMAGE_STAGE_LABELS[stageKey]}</span>
      <button
        type="button"
        className="damage-stage-button"
        disabled={stage === 6}
        aria-label={`${roleName}の${DAMAGE_STAGE_NAMES[stageKey]}ランクを上げる`}
        onClick={() => onChange(adjustStatStage(stages, stageKey, 1))}
      >
        ▲
      </button>
      <span className={`damage-stage-value ${stage > 0 ? "positive" : stage < 0 ? "negative" : ""}`}>
        {formatStatStage(stage)}
      </span>
      <button
        type="button"
        className="damage-stage-button"
        disabled={stage === -6}
        aria-label={`${roleName}の${DAMAGE_STAGE_NAMES[stageKey]}ランクを下げる`}
        onClick={() => onChange(adjustStatStage(stages, stageKey, -1))}
      >
        ▼
      </button>
    </div>
  );
}

export function MatchupPanel() {
  const [me, setMe] = useState<MySideConfig>({
    species: "",
    ability: "",
    item: "",
    move: "",
    points: { hp: 32, atk: 32, spe: 2 },
    stages: createNeutralStatStages(),
  });
  const [opp, setOpp] = useState<OpponentConfig>({
    species: "",
    ability: "",
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  });
  const detection = usePokemonDetection();

  useEffect(() => {
    setMe((current) => {
      if (current.species === detection.selection.player) return current;
      const species = detection.selection.player;
      const ability = species
        ? reconcileAbilitySelection(current.ability, getAbilityNames(species))
        : "";
      return { ...current, species, ability, move: "" };
    });
  }, [detection.selection.player]);

  useEffect(() => {
    setOpp((current) => {
      if (current.species === detection.selection.opponent) return current;
      const species = detection.selection.opponent;
      const ability = species
        ? reconcileAbilitySelection(current.ability, getAbilityNames(species))
        : "";
      return { ...current, species, ability, move: "" };
    });
  }, [detection.selection.opponent]);

  const myMoves = useMoveCandidates(me.species);
  const oppMoves = useMoveCandidates(opp.species);
  const myAbilities = useAbilityCandidates(me.species);
  const oppAbilities = useAbilityCandidates(opp.species);
  const myStageKeys = useMemo(() => damageStageKeysForMove(me.move ?? ""), [me.move]);
  const oppStageKeys = useMemo(() => damageStageKeysForMove(opp.move ?? ""), [opp.move]);

  const myAttack = useMemo(() => calcMyAttack(me, opp), [me, opp]);
  const oppAttack = useMemo(() => calcOpponentAttack(me, opp), [me, opp]);

  return (
    <div className="matchup-panel">
      <div className="detection-control" aria-label="画面からポケモン名を検出">
        <button
          type="button"
          aria-busy={detection.selection.status === "detecting"}
          aria-label="現在の対戦画面から両方のポケモン名を検出"
          className={`detection-trigger-button ${detection.selection.status === "detecting" ? "detecting" : ""}`}
          disabled={
            detection.requestingDetection ||
            detection.selection.status === "detecting" ||
            !detection.synchronized
          }
          title={detection.selection.status === "detecting" ? "検出中" : "ポケモン名を検出"}
          onClick={() => void detection.detect()}
        >
          <span className="detection-trigger-indicator" aria-hidden="true" />
          検出
        </button>
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
          <IconRow icon={<AbilityIcon />}>
            <SearchSelect
              entries={myAbilities}
              value={me.ability}
              onChange={(ability) => setMe({ ...me, ability })}
              placeholder="特性"
              display={jaAbility}
              disabled={!me.species}
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

        <div className="vs-divider">
          <div className="vs-stage-control upper leading">
            <DamageStageCounter
              stageKey={myStageKeys?.attacker ?? null}
              tone="mine"
              roleName="攻撃側"
              stages={me.stages}
              onChange={(stages) => setMe((current) => ({ ...current, stages }))}
            />
          </div>
          <div className="vs-stage-control upper trailing">
            <DamageStageCounter
              stageKey={myStageKeys?.defender ?? null}
              tone="opp"
              roleName="防御側"
              stages={opp.stages}
              onChange={(stages) => setOpp((current) => ({ ...current, stages }))}
            />
          </div>
          <span className="vs-badge" aria-hidden="true">VS</span>
          <div className="vs-stage-control lower leading">
            <DamageStageCounter
              stageKey={oppStageKeys?.defender ?? null}
              tone="mine"
              roleName="防御側"
              stages={me.stages}
              onChange={(stages) => setMe((current) => ({ ...current, stages }))}
            />
          </div>
          <div className="vs-stage-control lower trailing">
            <DamageStageCounter
              stageKey={oppStageKeys?.attacker ?? null}
              tone="opp"
              roleName="攻撃側"
              stages={opp.stages}
              onChange={(stages) => setOpp((current) => ({ ...current, stages }))}
            />
          </div>
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
          <IconRow icon={<AbilityIcon />}>
            <SearchSelect
              entries={oppAbilities}
              value={opp.ability}
              onChange={(ability) => setOpp({ ...opp, ability })}
              placeholder="特性"
              display={jaAbility}
              disabled={!opp.species}
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
