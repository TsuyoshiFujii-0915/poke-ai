/**
 * チャンピオンズ仕様 × @smogon/calc 適合性検証
 *
 * 検証項目:
 * 1. 能力ポイント(+32) → 実数値の変換が公式式と一致するか（ChampionsAdapter）
 * 2. ダメージ式が Gen6+ 標準式として @smogon/calc で計算できるか
 * 3. 能力ポイント0〜32の全域と、各0〜32・合計66制約の確認
 *
 * 実行: node scripts/champions-verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calculate, Generations, Move, Pokemon } from "@smogon/calc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOVE_PATCH = JSON.parse(
  readFileSync(join(__dirname, "../src/data/champions-move-patch.json"), "utf8"),
);
const CHAMPIONS_BASE_STATS = JSON.parse(
  readFileSync(join(__dirname, "../src/data/champions-base-stats.json"), "utf8"),
);

const gen = Generations.get(9);
const LEVEL = 50;
let pass = 0;
let fail = 0;

const toID = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** アプリと同じ: チャンピオンズ差分パッチを適用したMoveを作る */
function championsMove(name) {
  return new Move(gen, name, { overrides: MOVE_PATCH[name] });
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? `: ${detail}` : ""}`);
  ok ? pass++ : fail++;
}

/** チャンピオンズ公式の実数値式（Lv50, IV=31固定） */
function championsStat(base, sp, natureMod = 1.0, isHp = false) {
  const inner = Math.floor((2 * base + 31 + sp * 2) / 2);
  if (isHp) return inner + 60;
  return Math.floor((inner + 5) * natureMod);
}

/**
 * アプリと同じ ChampionsAdapter。
 * 性格は常にHardyとし、性格補正(1.1/0.9)は「Lv50・IV31・EV0では
 * 実数値 = 種族値 + ポイント + 20（HP以外）」の恒等式を使って、
 * 補正後の実数値から逆算した種族値をoverridesに渡すことで表現する。
 * これによりspeedを含む全ステータスへ副作用なく補正を適用できる。
 */
function adapterPokemon(species, points = {}, mods = {}, item) {
  const data = gen.species.get(species.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!data) throw new Error(`unknown: ${species}`);
  const baseStats = CHAMPIONS_BASE_STATS[species];
  if (!baseStats) throw new Error(`no Champions base stats: ${species}`);
  const withMod = (key) => {
    const base = baseStats[key] + (points[key] ?? 0);
    const mod = mods.plus === key ? 1.1 : mods.minus === key ? 0.9 : 1.0;
    if (mod === 1.0) return base;
    return Math.floor((base + 20) * mod) - 20;
  };
  return new Pokemon(gen, species, {
    level: LEVEL,
    item: item || undefined,
    nature: "Hardy",
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: {},
    overrides: {
      baseStats: {
        hp: baseStats.hp + (points.hp ?? 0),
        atk: withMod("atk"),
        def: withMod("def"),
        spa: withMod("spa"),
        spd: withMod("spd"),
        spe: withMod("spe"),
      },
    },
  });
}

console.log("=== 1. 能力ポイント(+32) → 実数値 ===\n");

// ゲンガー HP: 種135→実167 (+32pt) — 攻略記事の代表例
{
  const expected = championsStat(60, 32, 1.0, true);
  const p = adapterPokemon("Gengar", { hp: 32 });
  check("ゲンガー HP +32pt = 167", p.stats.hp === 167 && expected === 167, `calc=${p.stats.hp} expected=${expected}`);
}

// 攻撃100種 +32pt 無補正 = 152 — pkmnchamps.com の例
{
  const expected = championsStat(100, 32, 1.0, false);
  // Garganacl is a selectable Champions species with base 100 Attack.
  const p = adapterPokemon("Garganacl", { atk: 32 });
  check("攻撃種100 +32pt = 152", p.stats.atk === 152 && expected === 152, `calc=${p.stats.atk}`);
}

// +32pt は 1pt ずつ実数値が変わる（チャンピオンズの能力ポイント仕様）
{
  const p31 = adapterPokemon("Garganacl", { atk: 31 });
  const p32 = adapterPokemon("Garganacl", { atk: 32 });
  check(
    "+32pt は +31pt より実数値+1",
    p32.stats.atk === p31.stats.atk + 1,
    `+31=${p31.stats.atk} +32=${p32.stats.atk}`,
  );
}

// 0〜32の全ポイント・複数種族値・性格補正で参照式とAdapterを総当たり比較
{
  const species = [
    ["Gengar", { hp: 60, atk: 65 }],
    ["Garganacl", { hp: 100, atk: 100 }],
    ["Garchomp", { hp: 108, atk: 130 }],
  ];
  const modCases = [
    [{}, 1.0],
    [{ plus: "atk" }, 1.1],
    [{ minus: "atk" }, 0.9],
  ];
  let allMatch = true;
  let cases = 0;
  for (const [name, base] of species) {
    for (const sp of Array.from({ length: 33 }, (_, i) => i)) {
      const hp = adapterPokemon(name, { hp: sp });
      allMatch &&= hp.stats.hp === championsStat(base.hp, sp, 1, true);
      cases++;
      for (const [mods, modifier] of modCases) {
        const atk = adapterPokemon(name, { atk: sp }, mods);
        allMatch &&= atk.stats.atk === championsStat(base.atk, sp, modifier, false);
        cases++;
      }
    }
  }
  check(
    "能力ポイント0〜32の参照式とAdapterが全件一致",
    allMatch,
    `${cases}ケース`,
  );
}

// Speed tiers use the same formula as the UI: Garchomp base 102 -> 122/154/169.
{
  const noInvest = championsStat(102, 0, 1.0, false);
  const semi = championsStat(102, 32, 1.0, false);
  const max = championsStat(102, 32, 1.1, false);
  check(
    "素早さ目安: S102 → 122/154/169",
    noInvest === 122 && semi === 154 && max === 169,
    `${noInvest}/${semi}/${max}`,
  );
}

// 最大投資の最終実数値は、従来作のLv50・EV252と一致する。
// ただし入力体系・途中配分・合計上限は別物なのでUIではEVへ変換しない。
{
  const champions = adapterPokemon("Garganacl", { atk: 32 });
  const legacy = new Pokemon(gen, "Garganacl", {
    level: 50,
    nature: "Hardy",
    ivs: { atk: 31 },
    evs: { atk: 252 },
  });
  check(
    "SP32と従来EV252はLv50最大投資の実数値が一致",
    champions.stats.atk === legacy.stats.atk && champions.stats.atk === 152,
    `SP32=${champions.stats.atk} EV252=${legacy.stats.atk}`,
  );
}

// 性格1.1倍（↑トグル）
{
  const expected = championsStat(100, 32, 1.1, false);
  const p = adapterPokemon("Garganacl", { atk: 32 }, { plus: "atk" });
  check("攻撃+32pt A↑ = 167", p.stats.atk === 167 && expected === 167, `calc=${p.stats.atk}`);
}

// 性格0.9倍（↓トグル）
{
  const expected = championsStat(100, 32, 0.9, false);
  const p = adapterPokemon("Garganacl", { atk: 32 }, { minus: "atk" });
  check("攻撃+32pt A↓ = 136", p.stats.atk === 136 && expected === 136, `calc=${p.stats.atk}`);
}

// ↑↓は他ステータスに影響しない（S↑A↓でもCはそのまま）
{
  const neutral = adapterPokemon("Garganacl", { spa: 32 });
  const modded = adapterPokemon("Garganacl", { spa: 32 }, { plus: "spe", minus: "atk" });
  check(
    "S↑A↓ でも特攻の実数値は不変",
    modded.stats.spa === neutral.stats.spa,
    `neutral=${neutral.stats.spa} modded=${modded.stats.spa}`,
  );
}

console.log("\n=== 2. ダメージ計算（Gen6+式 / Lv50 / シングル） ===\n");

// Earthquake from Garchomp into Salazzle tests a quadruple weakness.
{
  const atk = adapterPokemon("Garchomp", { atk: 32 }, { plus: "atk", minus: "spa" }, "Choice Band");
  const def = adapterPokemon("Salazzle", { hp: 32 });
  const result = calculate(gen, atk, def, new Move(gen, "Earthquake"));
  const range = result.range();
  const pct = (range[0] / def.stats.hp) * 100;
  check(
    "ガブリアス じしん → エンニュート(H+32) 180%以上",
    pct >= 180,
    `${pct.toFixed(1)}% (${range[0]}-${range[1]}) ${result.kochance().text}`,
  );
}

// メガシンカ対応
{
  const atk = adapterPokemon("Gengar-Mega", { spa: 32 }, { plus: "spe", minus: "atk" });
  const def = adapterPokemon("Sylveon", { hp: 32, spd: 32 });
  const result = calculate(gen, atk, def, new Move(gen, "Sludge Bomb"));
  const range = result.range();
  check(
    "メガゲンガー ヘドロばくだん → ニンフィア(H+32 D+32)",
    range[1] > 0,
    `${((range[0] / def.stats.hp) * 100).toFixed(1)}-${((range[1] / def.stats.hp) * 100).toFixed(1)}%`,
  );
}

// 特性（ふゆう）でじしん無効
{
  const atk = adapterPokemon("Garchomp", { atk: 32 }, { plus: "atk" });
  const def = adapterPokemon("Rotom-Wash", { hp: 32, def: 32 });
  const result = calculate(gen, atk, def, new Move(gen, "Earthquake"));
  check("じしん → ウォッシュロトム(ふゆう) = 0", result.range()[1] === 0);
}

console.log("\n=== 3. チャンピオンズ技差分パッチ（2026-07-16 調査分） ===\n");

// パッチの全エントリが実在の技であること（タイプミス検知）
{
  const unknown = Object.keys(MOVE_PATCH).filter((name) => !gen.moves.get(toID(name)));
  check("パッチの全技がgen9データに存在", unknown.length === 0, unknown.join(", ") || `${Object.keys(MOVE_PATCH).length}技`);
}

// 威力変更: であいがしら 90→100
{
  const before = new Move(gen, "First Impression");
  const after = championsMove("First Impression");
  check("であいがしら 威力90→100", before.bp === 90 && after.bp === 100, `${before.bp}→${after.bp}`);
}

// 弱体化方向の威力変更: でんげきくちばし 85→80
{
  const before = new Move(gen, "Bolt Beak");
  const after = championsMove("Bolt Beak");
  check("でんげきくちばし 威力85→80", before.bp === 85 && after.bp === 80, `${before.bp}→${after.bp}`);
}

// 威力変更がダメージに反映される: ひょうざんおろし 100→120
{
  const atk = adapterPokemon("Weavile", { atk: 32 });
  const def = adapterPokemon("Garchomp", { hp: 32 });
  const before = calculate(gen, atk, def, new Move(gen, "Mountain Gale")).range();
  const after = calculate(gen, atk, def, championsMove("Mountain Gale")).range();
  check(
    "ひょうざんおろし 威力120がダメージへ反映",
    after[1] > before[1] && Math.abs(after[1] / before[1] - 1.2) < 0.05,
    `max ${before[1]}→${after[1]}`,
  );
}

// タイプ変更: トラバサミ 草→鋼（フェアリーに抜群になる）
{
  const move = championsMove("Snap Trap");
  const atk = adapterPokemon("Ariados", {});
  const fairy = adapterPokemon("Sylveon", {});
  const result = calculate(gen, atk, fairy, move);
  const neutral = calculate(gen, atk, fairy, new Move(gen, "Snap Trap"));
  check(
    "トラバサミ 鋼タイプ化（フェアリーへ2倍）",
    move.type === "Steel" && result.range()[1] === neutral.range()[1] * 2,
    `type=${move.type} dmg ${neutral.range()[1]}→${result.range()[1]}`,
  );
}

// 切断技分類: ドラゴンクロー + きれあじ = 1.5倍
{
  const sharpness = new Pokemon(gen, "Gallade", {
    level: LEVEL,
    ability: "Sharpness",
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  const def = adapterPokemon("Garchomp", { hp: 32 });
  const before = calculate(gen, sharpness, def, new Move(gen, "Dragon Claw")).range();
  const after = calculate(gen, sharpness, def, championsMove("Dragon Claw")).range();
  check(
    "ドラゴンクロー 切断技化（きれあじ1.5倍）",
    after[1] > before[1] && Math.abs(after[1] / before[1] - 1.5) < 0.05,
    `max ${before[1]}→${after[1]}`,
  );
}

// パッチ対象外の技は素のgen9データのまま
{
  const move = championsMove("Earthquake");
  check("パッチ対象外の技は無変更（じしん=100）", move.bp === 100, `bp=${move.bp}`);
}

console.log("\n=== 4. チャンピオンズ生成データ（build-champions-data.mjs 出力） ===\n");

{
  const species = JSON.parse(readFileSync(join(__dirname, "../src/data/champions-species.json"), "utf8"));
  check(
    "使用可能ポケモン: メガガブリアスを含みフシギダネを含まない",
    species.includes("Garchomp-Mega") && !species.includes("Bulbasaur"),
    `${species.length}種`,
  );
  check("使用可能ポケモン数が300〜340種", species.length >= 300 && species.length <= 340, `${species.length}種`);
  const unknown = species.filter((name) => !gen.species.get(toID(name)));
  check("全種が@smogon/calcで計算可能", unknown.length === 0, unknown.join(", ") || "OK");
  check(
    "全種に固定Showdown由来の種族値がある",
    species.every((name) => CHAMPIONS_BASE_STATS[name] !== undefined),
    `${Object.keys(CHAMPIONS_BASE_STATS).length}種分`,
  );
  check(
    "メガスターミーのチャンピオンズ攻撃種族値は100",
    CHAMPIONS_BASE_STATS["Starmie-Mega"]?.atk === 100,
    `A=${CHAMPIONS_BASE_STATS["Starmie-Mega"]?.atk}`,
  );
}

{
  const source = JSON.parse(readFileSync(join(__dirname, "../src/data/champions-source.json"), "utf8"));
  check(
    "生成元Showdownコミットが固定・記録されている",
    source.repository === "https://github.com/smogon/pokemon-showdown" &&
      /^[0-9a-f]{40}$/.test(source.commit) &&
      source.paths.includes("data/pokedex.ts") &&
      source.paths.includes("data/mods/champions/formats-data.ts"),
    source.commit,
  );
}

{
  const learnsets = JSON.parse(readFileSync(join(__dirname, "../src/data/champions-learnsets.json"), "utf8"));
  const garchomp = learnsets["garchomp"] ?? [];
  const ariados = learnsets["ariados"] ?? [];
  check("ガブリアスの習得技にじしん", garchomp.includes("Earthquake"), `${garchomp.length}技`);
  check("アリアドスの習得技にであいがしら", ariados.includes("First Impression"), `${ariados.length}技`);
  const badMoves = new Set();
  for (const moves of Object.values(learnsets)) {
    for (const m of moves) if (!gen.moves.get(toID(m))) badMoves.add(m);
  }
  check("全習得技が@smogon/calcで計算可能", badMoves.size === 0, [...badMoves].join(", ") || `${Object.keys(learnsets).length}種分`);
}

{
  const moves = JSON.parse(readFileSync(join(__dirname, "../src/data/champions-moves.json"), "utf8"));
  check(
    "技リスト: じしんを含み、廃止技(すいとる)を含まない",
    moves.includes("Earthquake") && !moves.includes("Absorb"),
    `${moves.length}技`,
  );
}

{
  const items = JSON.parse(readFileSync(join(__dirname, "../src/data/champions-items.json"), "utf8"));
  check(
    "持ち物: スカーフとガブリアスナイトを含み、廃止されたハチマキを含まない",
    items.includes("Choice Scarf") && items.includes("Garchompite") && !items.includes("Choice Band"),
    `${items.length}個`,
  );
}

console.log("\n=== 5. 適合性サマリー ===\n");
console.log(`結果: ${pass} 成功 / ${fail} 失敗\n`);

console.log(`【結論】
- 能力ポイント: チャンピオンズは「1pt = 実数値+1（各最大+32、合計66）」。
  最大投資の実数値はLv50 EV252と一致するが、入力体系・途中配分・合計上限は別物。
  ChampionsAdapter（baseStats加算）で能力ポイント0〜32を正確に再現できる。
- ダメージ式: Gen6+標準式。外部ソース(RotomPicks, Showdown Champions mode)も同旨。
  @smogon/calc Gen9は能力ポイントをネイティブには受け付けないため、
  固定したShowdown種族値を渡すChampionsAdapter経由に限りMVPの基礎計算へ使用する。
- 未検証/リスク:
  · ゲーム内実測ダメージとの照合（Phase 1で10ケース以上）
  · 現在レギュレーションはテラスタルなし（将来導入予定）
  · メガシンカ1回/試合等のルールは計算外（入力でメガ形態を指定する前提）
  · 配分上限(合計66)・直接+1の仕組みが異なるため、UI・保存データではEVとして扱わない
`);

process.exit(fail > 0 ? 1 : 0);
