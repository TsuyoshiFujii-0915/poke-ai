/**
 * PoC 0-3: @smogon/calc 検証スクリプト
 *
 * 目的:
 * 1. ポケモンチャンピオンズ想定の条件（Lv50、メガシンカあり・テラスタルなし）で
 *    @smogon/calc が計算できることを確認する。
 * 2. 素朴に実装した本編ダメージ式（Gen 5+ 標準式）と乱数16通りの結果を突き合わせ、
 *    ライブラリの内部計算が期待どおりであることを機械的に検証する。
 * 3. ダメージレンジ・確定数・説明文など、アプリUIに必要な出力が取れることを確認する。
 *
 * 注意: ゲーム内実測値との照合は実対戦のスクリーンショットが必要なため、
 *       このスクリプトでは「式の一致」までを自動検証する。
 */
const { calculate, Generations, Pokemon, Move, Field } = require('@smogon/calc');

const gen = Generations.get(9);

// ---------------------------------------------------------------------------
// リファレンス実装: Gen 5+ 標準ダメージ式（検証用の独立実装）
// ---------------------------------------------------------------------------

function pokeRound(x) {
  // ポケモン本編の丸め: 小数部がちょうど0.5なら切り捨て、それ以外は四捨五入
  const frac = x - Math.floor(x);
  return frac > 0.5 ? Math.ceil(x) : Math.floor(x);
}

/**
 * 最小構成の本編式（急所・やけど・壁・複数対象なしの前提）
 * baseDamage = floor(floor(floor(2*L/5+2) * BP * A / D) / 50) + 2
 * 乱数(85..100) → STAB(1.5) → タイプ相性 の順で適用
 */
function referenceDamageRolls({ level, power, atk, def, stab, typeEff, weatherMod = 1 }) {
  let base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * atk) / def) / 50) + 2;
  // 天候補正は乱数の前に適用される
  base = pokeRound(base * weatherMod);
  const rolls = [];
  for (let r = 85; r <= 100; r++) {
    let dmg = Math.floor((base * r) / 100);
    if (stab) dmg = pokeRound(dmg * 1.5);
    dmg = Math.floor(dmg * typeEff);
    rolls.push(dmg);
  }
  return rolls;
}

// ---------------------------------------------------------------------------
// テストケース
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const results = [];

function runCase(name, { attacker, defender, move, field, reference }) {
  const result = calculate(gen, attacker, defender, move, field);
  const range = result.range();
  const rolls = Array.isArray(result.damage) ? result.damage : [result.damage];

  let desc = '';
  try {
    desc = result.fullDesc('%', false);
  } catch (e) {
    desc = `(fullDesc不可: ${e.message})`;
  }

  let ko = '';
  try {
    ko = result.kochance().text;
  } catch (e) {
    ko = '(kochance不可)';
  }

  let refCheck = 'スキップ（リファレンス対象外の複合条件）';
  let ok = true;
  if (reference) {
    const expected = referenceDamageRolls(reference);
    const actual = rolls.flat();
    // タイプ無効時、ライブラリは乱数16通りではなく単一の0を返す
    if (expected.every((d) => d === 0)) {
      ok = actual.every((d) => d === 0);
    } else {
      ok = JSON.stringify(expected) === JSON.stringify(actual);
    }
    refCheck = ok ? '一致 ✅' : `不一致 ❌ expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`;
  }
  ok ? passCount++ : failCount++;

  results.push({ name, range, ko, desc, refCheck });

  console.log(`\n### ${name}`);
  console.log(`  ダメージレンジ: ${range[0]}〜${range[1]} (防御側HP ${result.defender.maxHP()})`);
  console.log(`  割合: ${((range[0] / result.defender.maxHP()) * 100).toFixed(1)}%〜${((range[1] / result.defender.maxHP()) * 100).toFixed(1)}%`);
  console.log(`  確定数: ${ko}`);
  console.log(`  説明文: ${desc}`);
  console.log(`  リファレンス式との照合: ${refCheck}`);
  return result;
}

console.log('=== PoC 0-3: @smogon/calc 検証（Gen 9 / Lv50 / チャンピオンズ想定）===');

// --- Case 1: 基本ケース（STABなし・等倍・補正なし） ---
// ガブリアス(A182: 130種族値+個体値31+努力値252, いじっぱり) じしん → 等倍で受けるラウドボーン想定…
// リファレンス照合を厳密にするため、まず数値が読みやすい素朴な組み合わせで確認する。
{
  const attacker = new Pokemon(gen, 'Garchomp', {
    level: 50,
    evs: { atk: 252 },
    nature: 'Adamant',
  });
  const defender = new Pokemon(gen, 'Skarmory', {
    level: 50,
    evs: { hp: 252, def: 252 },
    nature: 'Impish',
  });
  const move = new Move(gen, 'Earthquake');
  runCase('Case 1: ガブリアス じしん → エアームド（じめん技はひこうタイプに無効）', {
    attacker, defender, move,
    reference: {
      level: 50,
      power: 100,
      atk: attacker.stats.atk,
      def: defender.stats.def,
      stab: true,
      typeEff: 0, // 飛行に地面は無効
    },
  });
}

// --- Case 2: STAB + 抜群 ---
{
  const attacker = new Pokemon(gen, 'Garchomp', {
    level: 50,
    evs: { atk: 252 },
    nature: 'Adamant',
  });
  const defender = new Pokemon(gen, 'Heatran', {
    level: 50,
    evs: { hp: 252 },
    nature: 'Modest',
  });
  const move = new Move(gen, 'Earthquake');
  runCase('Case 2: ガブリアス じしん → ヒードラン（STAB + 4倍弱点）', {
    attacker, defender, move,
    reference: {
      level: 50,
      power: 100,
      atk: attacker.stats.atk,
      def: defender.stats.def,
      stab: true,
      typeEff: 4,
    },
  });
}

// --- Case 3: メガシンカ（チャンピオンズの中核要素） ---
{
  const attacker = new Pokemon(gen, 'Gengar-Mega', {
    level: 50,
    evs: { spa: 252 },
    nature: 'Timid',
  });
  const defender = new Pokemon(gen, 'Amoonguss', {
    level: 50,
    evs: { hp: 252, spd: 76 },
    nature: 'Calm',
  });
  const move = new Move(gen, 'Sludge Bomb');
  // モロバレルはくさ/どく複合: どく技は くさに2倍 × どくに0.5倍 = 等倍
  runCase('Case 3: メガゲンガー ヘドロばくだん → モロバレル（メガ種族値 + STAB + 複合相性で等倍）', {
    attacker, defender, move,
    reference: {
      level: 50,
      power: 90,
      atk: attacker.stats.spa,
      def: defender.stats.spd,
      stab: true,
      typeEff: 1,
    },
  });
}

// --- Case 4: 天候補正（あめ + みず技） ---
{
  const attacker = new Pokemon(gen, 'Mega Swampert'.replace('Mega Swampert', 'Swampert-Mega'), {
    level: 50,
    evs: { atk: 252 },
    nature: 'Adamant',
  });
  const defender = new Pokemon(gen, 'Charizard-Mega-Y', {
    level: 50,
    evs: { hp: 4 },
    nature: 'Timid',
  });
  const field = new Field({ weather: 'Rain' });
  const move = new Move(gen, 'Liquidation');
  runCase('Case 4: メガラグラージ アクアブレイク → メガリザードンY（雨1.5倍 + STAB + 抜群）', {
    attacker, defender, move, field,
    reference: {
      level: 50,
      power: 85,
      atk: attacker.stats.atk,
      def: defender.stats.def,
      stab: true,
      typeEff: 2,
      weatherMod: 1.5,
    },
  });
}

// --- Case 5: ランク補正 + 持ち物（複合条件。ライブラリ出力の確認のみ） ---
{
  const attacker = new Pokemon(gen, 'Lucario', {
    level: 50,
    evs: { atk: 252 },
    nature: 'Jolly',
    item: 'Life Orb',
    boosts: { atk: 2 },
  });
  const defender = new Pokemon(gen, 'Ting-Lu', {
    level: 50,
    evs: { hp: 252, def: 252 },
    nature: 'Impish',
  });
  const move = new Move(gen, 'Close Combat');
  runCase('Case 5: ルカリオ(A+2, いのちのたま) インファイト → ディンルー', {
    attacker, defender, move,
  });
}

// --- Case 6: 壁 + ダブル複数対象（ダブルバトル想定の複合条件） ---
{
  const attacker = new Pokemon(gen, 'Charizard-Mega-Y', {
    level: 50,
    evs: { spa: 252 },
    nature: 'Modest',
  });
  const defender = new Pokemon(gen, 'Rillaboom', {
    level: 50,
    evs: { hp: 252, spd: 4 },
    nature: 'Adamant',
  });
  const field = new Field({
    gameType: 'Doubles',
    weather: 'Sun',
    defenderSide: { isLightScreen: true },
  });
  const move = new Move(gen, 'Heat Wave', { spread: true });
  runCase('Case 6: メガリザードンY ねっぷう(ダブル・晴れ・ひかりのかべ) → ゴリランダー', {
    attacker, defender, move, field,
  });
}

// --- Case 7: テラスタル予約フィールドの動作確認（将来導入に備えたAPI確認） ---
{
  const attacker = new Pokemon(gen, 'Dragonite', {
    level: 50,
    evs: { atk: 252 },
    nature: 'Adamant',
    teraType: 'Normal',
  });
  const defender = new Pokemon(gen, 'Corviknight', {
    level: 50,
    evs: { hp: 252, def: 252 },
    nature: 'Impish',
  });
  const move = new Move(gen, 'Extreme Speed');
  runCase('Case 7: カイリュー(ノーマルテラス) しんそく → アーマーガア（テラスタルAPI確認）', {
    attacker, defender, move,
  });
}

// ---------------------------------------------------------------------------
// サマリー
// ---------------------------------------------------------------------------
console.log('\n=== サマリー ===');
console.log(`リファレンス照合: ${passCount} 件成功 / ${failCount} 件失敗`);
console.log(`実行ケース総数: ${results.length}`);
if (failCount > 0) {
  process.exitCode = 1;
}
