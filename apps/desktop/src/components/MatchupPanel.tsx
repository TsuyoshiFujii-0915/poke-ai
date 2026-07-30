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
import { isManualAbilityTrigger } from "../lib/ability-calculation";
import {
  createBattleEnvironment,
  type BattleTerrain,
  type BattleWeather,
} from "../lib/battle-environment";
import { detectionControlContent } from "../lib/detection-state";
import { jaAbility, jaItem, jaMove, jaSpecies, type NameEntry } from "../lib/names";
import { normalizePointInput } from "../lib/point-input";
import {
  adjustStatStage,
  createNeutralStatStages,
  type StatStages,
} from "../lib/stat-stage";
import { createInitialMySideConfig } from "../lib/initial-config";
import type { DamageStageKey } from "../lib/damage-stage";
import { usePokemonDetection } from "../lib/use-pokemon-detection";
import {
  getMegaEvolutionState,
  isSameMegaEvolutionFamily,
} from "../lib/mega-evolution";
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

const SELECTABLE_SPECIES = speciesEntries();
const SELECTABLE_SPECIES_NAMES = SELECTABLE_SPECIES.map((entry) => entry.en);

/** モンスターボールのラインアイコン（色は親のcurrentColorに従う） */
function BallIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2" />
      <path d="M2.5 12h6" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 12h6" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function MegaEvolutionIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="17" height="18" aria-hidden="true">
      <defs>
        <linearGradient id="mega-evolution-gradient" x1="7" y1="3" x2="17" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd75a" />
          <stop offset="0.28" stopColor="#78dd72" />
          <stop offset="0.55" stopColor="#58c9ef" />
          <stop offset="0.78" stopColor="#9b83ed" />
          <stop offset="1" stopColor="#ff72b4" />
        </linearGradient>
      </defs>
      <path
        d="M14.2 1.8c-1.7 2.4-1.7 3.9.1 4.8 1.1.5 2.7.8 4.1 1.4 2.5 1 3.6 2.7 3 5.2-.8 3.3-4.4 7-10.4 10.2 2.2-2.8 2.7-4.8-.6-6.5-4.8-2.4-7.6-4.3-7.3-7 .3-2.9 4-5.4 12-7.7Zm-3 3.6 2.3-.8.7 1.8-3.8.5.8-1.5Zm-4 3.1c3.8-.9 7.4-1.2 9.6-1l1.7 1.1c-4 .1-8.2.6-12.5 1.6-.1-.8.3-1.4 1.2-1.7Zm-.7 3.1c4.8-.9 9.8-1.7 12.4-1.2.8.2 1.2.8 1.2 1.6-4.8.3-9.2.9-12.9 1.6l-.7-2Zm7.8 4c1.5-.6 3-.8 4.4-.7-.2 1.5-1.4 2.8-3.8 4-.1-1.4-.2-2.4-.6-3.3Z"
        fill="url(#mega-evolution-gradient)"
        fillRule="evenodd"
        clipRule="evenodd"
        stroke="currentColor"
        strokeWidth="0.55"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MegaEvolutionControl({
  species,
  catalog,
  onChange,
}: {
  species: string;
  catalog: readonly string[];
  onChange: (species: string) => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const mega = getMegaEvolutionState(species, catalog);

  useEffect(() => {
    setMenuOpen(false);
  }, [species]);

  if (mega === null) {
    return <BallIcon />;
  }
  const active = mega.activeVariant !== null;
  const activeSuffix = mega.activeVariant === null
    ? ""
    : mega.activeVariant.slice(`${mega.baseSpecies}-Mega`.length).replace(/^-/, "");
  const toggle = (): void => {
    if (mega.activeVariant !== null) {
      onChange(mega.baseSpecies);
      return;
    }
    if (mega.variants.length === 1) {
      onChange(mega.variants[0]);
      return;
    }
    setMenuOpen((current) => !current);
  };

  return (
    <div
      className="mega-evolution-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setMenuOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`mega-evolution-button ${active ? "active" : ""}`}
        aria-label={active ? "メガシンカを解除" : "メガシンカ"}
        aria-pressed={active}
        aria-expanded={mega.variants.length > 1 ? menuOpen : undefined}
        title={active ? "メガシンカ中（クリックで解除）" : "メガシンカ"}
        onClick={toggle}
      >
        <MegaEvolutionIcon />
        {activeSuffix && <span className="mega-form-badge">{activeSuffix}</span>}
      </button>
      {menuOpen && (
        <div className="mega-form-menu" aria-label="メガシンカ先を選択">
          {mega.variants.map((variant) => (
            <button key={variant} type="button" onClick={() => onChange(variant)}>
              {jaSpecies(variant)}
            </button>
          ))}
        </div>
      )}
    </div>
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

function AbilityActivationControl({
  ability,
  automaticActive,
  manualActive,
  onManualChange,
}: {
  ability: string;
  automaticActive: boolean;
  manualActive: boolean;
  onManualChange: (active: boolean) => void;
}): ReactNode {
  const manual = isManualAbilityTrigger(ability);
  const active = manual ? manualActive : automaticActive;
  const title = manual
    ? active
      ? `${jaAbility(ability)}の発動状態を解除`
      : `${jaAbility(ability)}を発動済みにする`
    : active
      ? `${jaAbility(ability)}が現在の計算に適用中`
      : "現在の計算では特性補正なし";

  return (
    <button
      type="button"
      className={`ability-activation-button ${active ? "active" : ""} ${manual ? "manual" : "automatic"}`}
      aria-label={title}
      aria-pressed={active}
      disabled={!ability || !manual}
      title={title}
      onClick={() => onManualChange(!manualActive)}
    >
      <AbilityIcon />
    </button>
  );
}

function WallIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M12 2.8 20 6v5.4c0 4.8-3.1 8.2-8 10-4.9-1.8-8-5.2-8-10V6l8-3.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8 9.2h8M8 12h8M9.5 14.8h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function WallControl({
  side,
  active,
  disabled,
  onChange,
}: {
  side: "mine" | "opp";
  active: boolean;
  disabled: boolean;
  onChange: (active: boolean) => void;
}): ReactNode {
  const sideLabel = side === "mine" ? "自分側" : "相手側";
  return (
    <button
      type="button"
      className={`wall-control ${side} ${active ? "active" : ""}`}
      aria-label={`${sideLabel}の壁補正${active ? "を解除" : "を有効化"}`}
      aria-pressed={active}
      disabled={disabled}
      title={`${sideLabel}の壁補正`}
      onClick={() => onChange(!active)}
    >
      <WallIcon />
    </button>
  );
}

interface EnvironmentChoice<T extends EnvironmentValue> {
  value: T;
  label: string;
}

type EnvironmentValue = BattleWeather | BattleTerrain;

const WEATHER_CHOICES: Array<EnvironmentChoice<BattleWeather>> = [
  { value: "None", label: "なし" },
  { value: "Sun", label: "晴れ" },
  { value: "Rain", label: "雨" },
  { value: "Sand", label: "砂嵐" },
  { value: "Snow", label: "雪" },
];

const TERRAIN_CHOICES: Array<EnvironmentChoice<BattleTerrain>> = [
  { value: "None", label: "なし" },
  { value: "Electric", label: "エレキフィールド" },
  { value: "Grassy", label: "グラスフィールド" },
  { value: "Psychic", label: "サイコフィールド" },
  { value: "Misty", label: "ミストフィールド" },
];

function EnvironmentGlyph({ value }: { value: EnvironmentValue }): ReactNode {
  if (value === "None") {
    return null;
  }
  if (value === "Sun") {
    return <span className="environment-symbol" aria-hidden="true">☀</span>;
  }
  if (value === "Rain") {
    return <span className="environment-symbol" aria-hidden="true">☂</span>;
  }
  if (value === "Sand") {
    return <span className="environment-symbol wind" aria-hidden="true">≋</span>;
  }
  if (value === "Snow") {
    return <span className="environment-symbol" aria-hidden="true">❄</span>;
  }
  if (value === "Electric") {
    return <span className="environment-symbol" aria-hidden="true">ϟ</span>;
  }
  if (value === "Grassy") {
    return <span className="environment-symbol" aria-hidden="true">♧</span>;
  }
  if (value === "Psychic") {
    return <span className="environment-symbol" aria-hidden="true">◉</span>;
  }
  if (value === "Misty") {
    return <span className="environment-symbol wind" aria-hidden="true">≋</span>;
  }
  throw new Error(`unsupported environment icon: ${value satisfies never}`);
}

function EnvironmentControl<T extends EnvironmentValue>({
  label,
  value,
  choices,
  placement,
  onChange,
}: {
  label: "WEATHER" | "FIELD";
  value: T;
  choices: Array<EnvironmentChoice<T>>;
  placement: "upper" | "lower";
  onChange: (value: T) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.value === value);
  if (selected === undefined) {
    throw new Error(`${label} has an unsupported selection: ${value}`);
  }
  const active = value !== "None";

  return (
    <div
      className={`environment-control ${placement}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`environment-trigger ${active ? "active" : ""}`}
        aria-label={`${label}: ${selected.label}`}
        aria-expanded={open}
        title={`${label}: ${selected.label}`}
        onClick={() => setOpen((current) => !current)}
      >
        {active ? <EnvironmentGlyph value={value} /> : label}
      </button>
      {open && (
        <div className="environment-menu" role="menu">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={choice.value === value ? "selected" : ""}
              role="menuitemradio"
              aria-checked={choice.value === value}
              onClick={() => {
                onChange(choice.value);
                setOpen(false);
              }}
            >
              <span className="environment-menu-icon">
                <EnvironmentGlyph value={choice.value} />
              </span>
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
function PokemonArt({
  species,
  side,
  wallActive,
  onWallChange,
}: {
  species: string;
  side: "mine" | "opp";
  wallActive: boolean;
  onWallChange: (active: boolean) => void;
}) {
  const artworkId = species ? getArtworkId(species) : null;
  const baseSpeed = species ? getBaseSpeed(species) : null;
  return (
    <div className={`poke-art ${side}`}>
      <WallControl
        side={side}
        active={wallActive}
        disabled={!species}
        onChange={onWallChange}
      />
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
  if (baseSpeed === null) {
    return <div className="speed-line placeholder" aria-hidden="true" />;
  }
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
      <span className="damage-stage-label-gap" aria-hidden="true" />
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
  const [me, setMe] = useState<MySideConfig>(createInitialMySideConfig);
  const [opp, setOpp] = useState<OpponentConfig>({
    species: "",
    ability: "",
    abilityTriggerActive: false,
    item: "",
    move: "",
    stages: createNeutralStatStages(),
  });
  const [environment, setEnvironment] = useState(createBattleEnvironment);
  const detection = usePokemonDetection();

  useEffect(() => {
    setMe((current) => {
      if (current.species === detection.selection.player) return current;
      const species = detection.selection.player;
      const ability = species
        ? reconcileAbilitySelection(current.ability, getAbilityNames(species))
        : "";
      const move = isSameMegaEvolutionFamily(
        current.species,
        species,
        SELECTABLE_SPECIES_NAMES,
      ) ? current.move : "";
      return { ...current, species, ability, abilityTriggerActive: false, move };
    });
  }, [detection.selection.player]);

  useEffect(() => {
    setOpp((current) => {
      if (current.species === detection.selection.opponent) return current;
      const species = detection.selection.opponent;
      const ability = species
        ? reconcileAbilitySelection(current.ability, getAbilityNames(species))
        : "";
      const move = isSameMegaEvolutionFamily(
        current.species,
        species,
        SELECTABLE_SPECIES_NAMES,
      ) ? current.move : "";
      return { ...current, species, ability, abilityTriggerActive: false, move };
    });
  }, [detection.selection.opponent]);

  const myMoves = useMoveCandidates(me.species);
  const oppMoves = useMoveCandidates(opp.species);
  const myAbilities = useAbilityCandidates(me.species);
  const oppAbilities = useAbilityCandidates(opp.species);
  const myStageKeys = useMemo(() => damageStageKeysForMove(me.move ?? ""), [me.move]);
  const oppStageKeys = useMemo(() => damageStageKeysForMove(opp.move ?? ""), [opp.move]);

  const myAttack = useMemo(() => calcMyAttack(me, opp, environment), [me, opp, environment]);
  const oppAttack = useMemo(
    () => calcOpponentAttack(me, opp, environment),
    [me, opp, environment],
  );
  const myAutomaticAbilityActive =
    myAttack.attackerAbilityApplied || oppAttack.defenderAbilityApplied;
  const oppAutomaticAbilityActive =
    oppAttack.attackerAbilityApplied || myAttack.defenderAbilityApplied;
  const detectionContent = detectionControlContent(
    detection.selection,
    detection.requestingDetection,
  );

  return (
    <div className="matchup-panel">
      <EnvironmentControl
        label="WEATHER"
        value={environment.weather}
        choices={WEATHER_CHOICES}
        placement="upper"
        onChange={(weather) => setEnvironment((current) => ({ ...current, weather }))}
      />
      <EnvironmentControl
        label="FIELD"
        value={environment.terrain}
        choices={TERRAIN_CHOICES}
        placement="lower"
        onChange={(terrain) => setEnvironment((current) => ({ ...current, terrain }))}
      />
      {/* 左: 自分のポケモン。相手側と高さが対角対応するよう
          ポケモン名・持ち物を上、公式絵を中、能力ポイントを下に置く */}
      <div className="side-col mine">
        <div className="side-fields">
          <IconRow icon={(
            <MegaEvolutionControl
              species={me.species}
              catalog={SELECTABLE_SPECIES_NAMES}
              onChange={(species) => detection.selectPokemon("player", species)}
            />
          )}>
            <SearchSelect
              entries={SELECTABLE_SPECIES}
              value={me.species}
              onChange={(species) => detection.selectPokemon("player", species)}
              placeholder="自分のポケモン"
              display={jaSpecies}
              disabled={false}
            />
          </IconRow>
          <IconRow icon={(
            <AbilityActivationControl
              ability={me.ability}
              automaticActive={myAutomaticAbilityActive}
              manualActive={me.abilityTriggerActive}
              onManualChange={(abilityTriggerActive) => setMe({ ...me, abilityTriggerActive })}
            />
          )}>
            <SearchSelect
              entries={myAbilities}
              value={me.ability}
              onChange={(ability) => setMe({ ...me, ability, abilityTriggerActive: false })}
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
        <PokemonArt
          species={me.species}
          side="mine"
          wallActive={environment.playerWallActive}
          onWallChange={(playerWallActive) =>
            setEnvironment((current) => ({ ...current, playerWallActive }))
          }
        />
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
          <button
            type="button"
            className={`detection-vs-button ${detectionContent}`}
            aria-label="現在の対戦画面から両方のポケモン名を検出"
            aria-busy={detectionContent === "loading"}
            disabled={
              detection.requestingDetection ||
              detection.selection.status === "detecting" ||
              !detection.synchronized
            }
            title={detection.error ?? "ポケモン名を再検出"}
            onClick={() => void detection.detect()}
          >
            {detectionContent === "loading"
              ? <span className="detection-spinner" aria-hidden="true" />
              : detectionContent.toUpperCase()}
            {detection.error && <span className="detection-error" aria-hidden="true">!</span>}
          </button>
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
        <PokemonArt
          species={opp.species}
          side="opp"
          wallActive={environment.opponentWallActive}
          onWallChange={(opponentWallActive) =>
            setEnvironment((current) => ({ ...current, opponentWallActive }))
          }
        />
        <SpeedTiersLine species={opp.species} />
        <div className="side-fields">
          <IconRow icon={(
            <MegaEvolutionControl
              species={opp.species}
              catalog={SELECTABLE_SPECIES_NAMES}
              onChange={(species) => detection.selectPokemon("opponent", species)}
            />
          )}>
            <SearchSelect
              entries={SELECTABLE_SPECIES}
              value={opp.species}
              onChange={(species) => detection.selectPokemon("opponent", species)}
              placeholder="相手のポケモン"
              display={jaSpecies}
              disabled={false}
            />
          </IconRow>
          <IconRow icon={(
            <AbilityActivationControl
              ability={opp.ability}
              automaticActive={oppAutomaticAbilityActive}
              manualActive={opp.abilityTriggerActive}
              onManualChange={(abilityTriggerActive) => setOpp({ ...opp, abilityTriggerActive })}
            />
          )}>
            <SearchSelect
              entries={oppAbilities}
              value={opp.ability}
              onChange={(ability) => setOpp({ ...opp, ability, abilityTriggerActive: false })}
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
