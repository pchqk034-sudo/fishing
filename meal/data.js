/* ==========================================================================
 * data.js — 食事管理アプリの静的データ
 *   - FOODS   : 和食中心の食品栄養データベース（1食分の目安）
 *   - MET      : 運動・行動別のMET（メッツ）値
 *   - BEHAVIOR : 1日の行動パターン別の生活活動係数（NEAT）
 * 依存ライブラリなし。plain script として読み込み、window に公開する。
 * 栄養値は文部科学省「日本食品標準成分表」等の一般値をもとにした概算。
 * ======================================================================== */

// 食品DB: name(料理/食材名), cat(カテゴリ), unit(1食の目安量), 栄養は「1食分」あたり
//   kcal, p=たんぱく質g, f=脂質g, c=炭水化物g, fiber=食物繊維g, salt=食塩相当量g
const FOODS = [
  // --- 主食 ---
  { name: "ごはん(白米)",       cat: "主食", unit: "茶碗1杯 150g", kcal: 234, p: 3.8, f: 0.5, c: 51.9, fiber: 2.3, salt: 0.0 },
  { name: "玄米ごはん",         cat: "主食", unit: "茶碗1杯 150g", kcal: 228, p: 4.2, f: 1.5, c: 51.3, fiber: 2.1, salt: 0.0 },
  { name: "食パン",             cat: "主食", unit: "6枚切り1枚 60g", kcal: 149, p: 5.3, f: 2.5, c: 27.8, fiber: 1.4, salt: 0.7 },
  { name: "うどん(かけ)",       cat: "主食", unit: "1杯", kcal: 320, p: 10.0, f: 2.0, c: 62.0, fiber: 2.5, salt: 4.5 },
  { name: "そば(ざる)",         cat: "主食", unit: "1人前", kcal: 296, p: 12.0, f: 2.0, c: 55.0, fiber: 4.0, salt: 2.8 },
  { name: "ラーメン(醤油)",     cat: "主食", unit: "1杯", kcal: 470, p: 20.0, f: 12.0, c: 68.0, fiber: 3.0, salt: 6.0 },
  { name: "チャーハン",         cat: "主食", unit: "1人前", kcal: 620, p: 14.0, f: 20.0, c: 95.0, fiber: 2.0, salt: 3.0 },
  { name: "パスタ(ミートソース)", cat: "主食", unit: "1人前", kcal: 600, p: 22.0, f: 18.0, c: 84.0, fiber: 5.0, salt: 3.2 },
  { name: "おにぎり(鮭)",       cat: "主食", unit: "1個 110g", kcal: 190, p: 5.0, f: 1.8, c: 38.0, fiber: 1.0, salt: 1.2 },

  // --- 主菜(肉・魚・卵・大豆) ---
  { name: "焼き鮭",             cat: "主菜", unit: "1切れ 80g", kcal: 133, p: 17.8, f: 6.5, c: 0.1, fiber: 0.0, salt: 1.5 },
  { name: "さばの塩焼き",       cat: "主菜", unit: "1切れ 80g", kcal: 202, p: 16.5, f: 13.4, c: 0.2, fiber: 0.0, salt: 1.2 },
  { name: "刺身盛り合わせ",     cat: "主菜", unit: "1人前", kcal: 160, p: 26.0, f: 5.0, c: 2.0, fiber: 0.0, salt: 1.5 },
  { name: "鶏むね肉(蒸し)",     cat: "主菜", unit: "100g", kcal: 116, p: 23.3, f: 1.9, c: 0.0, fiber: 0.0, salt: 0.4 },
  { name: "鶏の唐揚げ",         cat: "主菜", unit: "3個 100g", kcal: 290, p: 16.0, f: 18.0, c: 13.0, fiber: 0.5, salt: 1.5 },
  { name: "豚しょうが焼き",     cat: "主菜", unit: "1人前", kcal: 380, p: 20.0, f: 26.0, c: 12.0, fiber: 1.0, salt: 2.2 },
  { name: "ハンバーグ",         cat: "主菜", unit: "1個 150g", kcal: 420, p: 22.0, f: 28.0, c: 18.0, fiber: 1.5, salt: 2.0 },
  { name: "目玉焼き(卵1個)",    cat: "主菜", unit: "卵1個", kcal: 100, p: 6.8, f: 7.5, c: 0.2, fiber: 0.0, salt: 0.4 },
  { name: "納豆",               cat: "主菜", unit: "1パック 45g", kcal: 90, p: 7.4, f: 4.5, c: 5.4, fiber: 3.0, salt: 0.0 },
  { name: "冷奴(豆腐)",         cat: "主菜", unit: "半丁 150g", kcal: 84, p: 7.4, f: 4.7, c: 2.4, fiber: 0.6, salt: 0.0 },
  { name: "餃子",               cat: "主菜", unit: "5個", kcal: 265, p: 9.0, f: 14.0, c: 25.0, fiber: 2.0, salt: 1.8 },

  // --- 副菜(野菜・海藻・きのこ) ---
  { name: "サラダ(葉物)",       cat: "副菜", unit: "1皿", kcal: 60, p: 1.5, f: 3.5, c: 6.0, fiber: 2.5, salt: 0.8 },
  { name: "ほうれん草のおひたし", cat: "副菜", unit: "1鉢", kcal: 25, p: 2.5, f: 0.4, c: 3.0, fiber: 2.5, salt: 0.7 },
  { name: "ひじきの煮物",       cat: "副菜", unit: "1鉢", kcal: 75, p: 2.5, f: 3.5, c: 9.0, fiber: 3.5, salt: 1.3 },
  { name: "きんぴらごぼう",     cat: "副菜", unit: "1鉢", kcal: 95, p: 1.8, f: 4.5, c: 12.0, fiber: 3.5, salt: 1.2 },
  { name: "野菜炒め",           cat: "副菜", unit: "1皿", kcal: 150, p: 6.0, f: 9.0, c: 11.0, fiber: 3.0, salt: 1.8 },
  { name: "きのこソテー",       cat: "副菜", unit: "1皿", kcal: 70, p: 3.0, f: 4.5, c: 6.0, fiber: 4.0, salt: 0.9 },
  { name: "枝豆",               cat: "副菜", unit: "1皿 50g", kcal: 63, p: 5.8, f: 3.0, c: 4.4, fiber: 2.5, salt: 0.5 },
  { name: "キムチ",             cat: "副菜", unit: "50g", kcal: 23, p: 1.3, f: 0.2, c: 4.0, fiber: 1.4, salt: 1.1 },

  // --- 汁物 ---
  { name: "味噌汁",             cat: "汁物", unit: "1杯", kcal: 40, p: 2.5, f: 1.2, c: 5.0, fiber: 1.2, salt: 1.5 },
  { name: "豚汁",               cat: "汁物", unit: "1杯", kcal: 130, p: 6.0, f: 7.0, c: 11.0, fiber: 2.5, salt: 2.0 },
  { name: "コーンスープ",       cat: "汁物", unit: "1杯", kcal: 120, p: 3.0, f: 5.0, c: 16.0, fiber: 1.0, salt: 1.2 },

  // --- 果物・乳製品 ---
  { name: "バナナ",             cat: "果物", unit: "1本 100g", kcal: 86, p: 1.1, f: 0.2, c: 22.5, fiber: 1.1, salt: 0.0 },
  { name: "りんご",             cat: "果物", unit: "半個 130g", kcal: 74, p: 0.3, f: 0.2, c: 20.0, fiber: 2.0, salt: 0.0 },
  { name: "ヨーグルト(無糖)",   cat: "乳製品", unit: "100g", kcal: 62, p: 3.6, f: 3.0, c: 4.9, fiber: 0.0, salt: 0.1 },
  { name: "牛乳",               cat: "乳製品", unit: "コップ1杯 200ml", kcal: 134, p: 6.6, f: 7.6, c: 9.6, fiber: 0.0, salt: 0.2 },

  // --- 間食・その他 ---
  { name: "アーモンド",         cat: "間食", unit: "10粒 15g", kcal: 91, p: 3.0, f: 8.0, c: 3.1, fiber: 1.5, salt: 0.0 },
  { name: "チョコレート",       cat: "間食", unit: "板1/2 25g", kcal: 139, p: 1.7, f: 8.6, c: 13.8, fiber: 1.0, salt: 0.0 },
  { name: "ポテトチップス",     cat: "間食", unit: "小袋 30g", kcal: 166, p: 1.4, f: 10.5, c: 16.5, fiber: 1.3, salt: 0.3 },
  { name: "缶ビール",           cat: "飲料", unit: "350ml", kcal: 140, p: 1.1, f: 0.0, c: 10.9, fiber: 0.0, salt: 0.0 },
  { name: "日本酒",             cat: "飲料", unit: "1合 180ml", kcal: 185, p: 0.7, f: 0.0, c: 8.8, fiber: 0.0, salt: 0.0 },

  // --- プロテイン・高たんぱく ---
  { name: "プロテイン(水割り)",     cat: "プロテイン", unit: "1杯(粉30g)", kcal: 120, p: 24.0, f: 1.8, c: 2.5, fiber: 0.5, salt: 0.2 },
  { name: "プロテイン(牛乳割り)",   cat: "プロテイン", unit: "1杯(粉30g+牛乳200ml)", kcal: 250, p: 30.0, f: 9.0, c: 14.0, fiber: 0.5, salt: 0.4 },
  { name: "プロテインバー",         cat: "プロテイン", unit: "1本", kcal: 200, p: 15.0, f: 8.5, c: 20.0, fiber: 3.0, salt: 0.3 },
  { name: "サラダチキン",           cat: "主菜", unit: "1個 110g", kcal: 114, p: 24.5, f: 1.5, c: 1.0, fiber: 0.0, salt: 1.1 },
  { name: "ゆで卵",                 cat: "主菜", unit: "1個", kcal: 68, p: 6.2, f: 4.7, c: 0.2, fiber: 0.0, salt: 0.2 },
  { name: "冷しゃぶサラダ",         cat: "主菜", unit: "1人前", kcal: 320, p: 22.0, f: 22.0, c: 9.0, fiber: 3.0, salt: 1.8 },
  { name: "ギリシャヨーグルト",     cat: "乳製品", unit: "100g", kcal: 59, p: 10.0, f: 0.4, c: 4.0, fiber: 0.0, salt: 0.1 },
  { name: "ブロッコリー",           cat: "副菜", unit: "1皿 80g", kcal: 30, p: 3.6, f: 0.4, c: 4.1, fiber: 3.7, salt: 0.0 },

  // --- 麺・丼(よく食べるもの) ---
  { name: "卵かけごはん",           cat: "主食", unit: "1杯", kcal: 330, p: 10.5, f: 6.0, c: 56.0, fiber: 2.3, salt: 1.0 },
  { name: "釜玉うどん",             cat: "主食", unit: "1杯", kcal: 430, p: 15.0, f: 8.0, c: 76.0, fiber: 3.0, salt: 2.5 },
  { name: "釜玉そば",               cat: "主食", unit: "1杯", kcal: 400, p: 16.0, f: 8.0, c: 66.0, fiber: 4.0, salt: 2.3 },
  { name: "納豆卵うどん",           cat: "主食", unit: "1杯", kcal: 470, p: 20.0, f: 11.0, c: 77.0, fiber: 5.0, salt: 2.6 },
  { name: "納豆卵そば",             cat: "主食", unit: "1杯", kcal: 440, p: 21.0, f: 11.0, c: 66.0, fiber: 6.0, salt: 2.4 },
  { name: "中華そば(醤油)",         cat: "主食", unit: "1杯", kcal: 440, p: 18.0, f: 10.0, c: 66.0, fiber: 3.0, salt: 5.5 },
  { name: "味噌ラーメン",           cat: "主食", unit: "1杯", kcal: 550, p: 22.0, f: 17.0, c: 75.0, fiber: 4.0, salt: 6.5 },
  { name: "豚骨ラーメン",           cat: "主食", unit: "1杯", kcal: 500, p: 20.0, f: 18.0, c: 66.0, fiber: 3.0, salt: 6.0 },
  { name: "家系ラーメン",           cat: "主食", unit: "1杯", kcal: 700, p: 28.0, f: 28.0, c: 80.0, fiber: 3.0, salt: 7.0 },
  { name: "つけ麺",                 cat: "主食", unit: "1人前", kcal: 630, p: 26.0, f: 14.0, c: 100.0, fiber: 4.0, salt: 6.5 },

  // --- 低塩分バージョン(スープ・つゆを残した場合) ---
  { name: "ラーメン(醤油・汁残し)", cat: "主食", unit: "1杯(汁を飲まない)", kcal: 380, p: 18.0, f: 8.0, c: 66.0, fiber: 3.0, salt: 2.5 },
  { name: "中華そば(汁残し)",       cat: "主食", unit: "1杯(汁を飲まない)", kcal: 360, p: 16.0, f: 6.5, c: 64.0, fiber: 3.0, salt: 2.3 },
  { name: "味噌ラーメン(汁残し)",   cat: "主食", unit: "1杯(汁を飲まない)", kcal: 440, p: 20.0, f: 11.0, c: 72.0, fiber: 4.0, salt: 2.8 },
  { name: "豚骨ラーメン(汁残し)",   cat: "主食", unit: "1杯(汁を飲まない)", kcal: 400, p: 18.0, f: 12.0, c: 63.0, fiber: 3.0, salt: 2.6 },
  { name: "家系ラーメン(汁残し)",   cat: "主食", unit: "1杯(汁を飲まない)", kcal: 560, p: 25.0, f: 20.0, c: 76.0, fiber: 3.0, salt: 3.0 },
  { name: "つけ麺(つけ汁残し)",     cat: "主食", unit: "1人前(つけ汁を飲まない)", kcal: 560, p: 24.0, f: 11.0, c: 98.0, fiber: 4.0, salt: 3.0 },
  { name: "うどん(かけ・汁残し)",   cat: "主食", unit: "1杯(汁を飲まない)", kcal: 300, p: 9.0, f: 1.8, c: 61.0, fiber: 2.5, salt: 1.8 },

  // --- コーヒー・カフェ ---
  { name: "コーヒー(ブラック)",     cat: "飲料", unit: "1杯 150ml", kcal: 6, p: 0.3, f: 0.0, c: 1.1, fiber: 0.0, salt: 0.0 },
  { name: "カフェラテ",             cat: "飲料", unit: "1杯 200ml", kcal: 120, p: 6.5, f: 6.5, c: 9.5, fiber: 0.0, salt: 0.2 },
];

// 運動MET値: 単発の運動を「運動強度」として分類（消費kcal = MET × 体重kg × 時間h × 1.05）
const EXERCISE_MET = [
  { name: "ウォーキング(ゆっくり)", met: 3.0, level: "低強度" },
  { name: "ウォーキング(速歩)",     met: 4.3, level: "中強度" },
  { name: "ジョギング",             met: 7.0, level: "高強度" },
  { name: "ランニング",             met: 9.8, level: "高強度" },
  { name: "サイクリング(通勤)",     met: 6.0, level: "中強度" },
  { name: "水泳(クロール)",         met: 8.3, level: "高強度" },
  { name: "筋トレ(自重)",           met: 3.8, level: "中強度" },
  { name: "筋トレ(高強度)",         met: 6.0, level: "高強度" },
  { name: "ヨガ・ストレッチ",       met: 2.5, level: "低強度" },
  { name: "ゴルフ",                 met: 4.8, level: "中強度" },
  { name: "テニス",                 met: 7.3, level: "高強度" },
  { name: "登山・ハイキング",       met: 6.5, level: "高強度" },
  { name: "釣り(堤防・船)",         met: 3.5, level: "低強度" },
  { name: "釣り(渓流・磯歩き)",     met: 5.5, level: "中強度" },
  { name: "家事全般",               met: 3.3, level: "低強度" },
];

// 1日の行動パターン別 生活活動係数(NEAT係数)
//   基礎代謝からの上乗せ分の目安。歩数・運動は別途加算するため、
//   ここでは「その日の過ごし方」による地の活動量を表す。
const BEHAVIOR = [
  { name: "在宅ワーク・デスクワーク中心", factor: 1.25, desc: "座位が長く活動量が少ない日" },
  { name: "出社・通勤あり",               factor: 1.45, desc: "通勤や移動・立ち仕事を含む日" },
  { name: "立ち仕事・接客中心",           factor: 1.6,  desc: "1日を通してよく動く日" },
  { name: "釣り・アウトドア",             factor: 1.7,  desc: "野外で長時間活動する日" },
  { name: "肉体労働・スポーツ",           factor: 1.9,  desc: "強い身体活動が続く日" },
];

// 目標(目的)の選択肢と、目標摂取カロリーの補正(TDEEに対する増減)
const GOALS = [
  { key: "diet",     name: "減量したい",       adjust: -0.15, desc: "消費より約15%少なく" },
  { key: "keep",     name: "体型を維持したい", adjust: 0.0,   desc: "消費とほぼ同じ" },
  { key: "muscle",   name: "筋肉を増やしたい", adjust: 0.10,  desc: "消費より約10%多く・高たんぱく" },
  { key: "health",   name: "健康維持・数値改善", adjust: -0.05, desc: "消費よりやや少なく" },
];

window.MEAL_DATA = { FOODS, EXERCISE_MET, BEHAVIOR, GOALS };
