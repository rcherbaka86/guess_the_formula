/* ============================================================
   SETTINGS
============================================================ */
const ALLOWED_OPS = new Set(["+","-","*"]);
const TILE_COUNT = 8;
const MAX_GUESSES = 5;
const TZ_NAME = "America/New_York";

/* ============================================================
   DATE (DAILY PUZZLE) — America/New_York
============================================================ */
function todayKey(tzName){
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzName, year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(new Date());

  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`; // YYYY-MM-DD
}

/* ============================================================
   SEEDED RNG (string -> deterministic PRNG)
============================================================ */
function hashStringToUint32(str){
  // FNV-1a 32-bit hash
  let h = 2166136261 >>> 0;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed){
  return function(){
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max){
  return Math.floor(rng() * (max - min + 1)) + min; // inclusive
}

function randChoice(rng, arr){
  return arr[randInt(rng, 0, arr.length - 1)];
}

function isDigit(ch){
  return ch >= "0" && ch <= "9";
}

/* ============================================================
   FORMULA PARSING (8 tiles, 2–3 ops, numbers 1–3 digits)
============================================================ */
function normalizeText(s){
  return (s ?? "")
    .trim()
    .replaceAll("×","*")
    .replaceAll("−","-")
    .replaceAll(" ", "");
}

function parseFormulaFromTiles(tiles){
  if (tiles.length !== TILE_COUNT) throw new Error("Internal error: tiles must be length 8.");
  if (tiles[0] !== "x") throw new Error("Formula must start with x.");

  const ops = [];
  const nums = [];
  let i = 1;

  while (i < TILE_COUNT){
    const op = tiles[i];
    if (!ALLOWED_OPS.has(op)) throw new Error("Operators allowed are +, -, * (no division).");
    ops.push(op);
    i++;

    if (i >= TILE_COUNT || !isDigit(tiles[i])) throw new Error("Expected a digit after an operator.");

    // Read 1–3 digit number (all consecutive digits up to 3)
    let numStr = tiles[i]; i++;
    if (i < TILE_COUNT && isDigit(tiles[i])) { numStr += tiles[i]; i++; }
    if (i < TILE_COUNT && isDigit(tiles[i])) { numStr += tiles[i]; i++; }

    // 4th digit in same number is not allowed (shouldn't happen with 8 tiles, but enforced)
    if (i < TILE_COUNT && isDigit(tiles[i])) throw new Error("Numbers can only be 1, 2, or 3 digits long.");

    nums.push(parseInt(numStr, 10));
  }

  if (!(ops.length === 2 || ops.length === 3)) throw new Error("Formula must contain 2 or 3 operations.");
  if (nums.length !== ops.length) throw new Error("Internal error: numbers and ops count mismatch.");

  return {ops, nums};
}

/* ============================================================
   FORMULA GENERATION (8 tiles exact)
============================================================ */
function generateFormulaString(rng){
  while (true){
    const opCount = randChoice(rng, [2,3]);
    let chars = ["x"];

    for (let k=0; k<opCount; k++){
      chars.push(randChoice(rng, Array.from(ALLOWED_OPS)));

      // numbers can be 1–3 digits => 1..999
      const n = randInt(rng, 1, 999);
      const digits = String(n).split("");

      if (chars.length + digits.length > TILE_COUNT){
        chars = null; // retry
        break;
      }
      chars.push(...digits);
    }

    if (!chars || chars.length !== TILE_COUNT) continue;

    const s = chars.join("").toLowerCase();
    try{
      parseFormulaFromTiles(s.split(""));
      return s;
    }catch(_e){
      continue;
    }
  }
}

function dailySecret(dateStr){
  const seed = hashStringToUint32(`daily-v4::tiles8::1to3digits::${dateStr}`);
  const rng = mulberry32(seed);
  return generateFormulaString(rng);
}

/* ============================================================
   MATH (left-to-right, no division)
============================================================ */
function applyOp(a, op, b){
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  throw new Error("Unsupported operator.");
}

function evalLeftToRight(x, ops, nums){
  let v = x;
  for (let i=0;i<ops.length;i++){
    v = applyOp(v, ops[i], nums[i]);
  }
  return v;
}

/* ============================================================
   GUESS HANDLING (x implied, exactly 8 chars)
============================================================ */
function tilesFromGuess(userInput){
  let s = normalizeText(userInput);
  if (!s) throw new Error("Enter a guess like +8+9 (x is automatic).");

  if (s[0].toLowerCase() !== "x") s = "x" + s;
  s = s.toLowerCase();

  if (s.length !== TILE_COUNT){
    throw new Error(`Your guess must be exactly ${TILE_COUNT} characters after adding x. Right now it's ${s.length}.`);
  }
  if (s[0] !== "x") throw new Error("The first character must be x.");

  return s.split("");
}

/* ============================================================
   TILE FEEDBACK (correct / misplaced / absent)
============================================================ */
function compareTiles(secretTiles, guessTiles){
  const states = Array(TILE_COUNT).fill("absent");
  const remaining = new Map();

  // pass 1: exact matches + remaining counts
  for (let i=0;i<TILE_COUNT;i++){
    if (guessTiles[i] === secretTiles[i]){
      states[i] = "correct";
    } else {
      const ch = secretTiles[i];
      remaining.set(ch, (remaining.get(ch) ?? 0) + 1);
    }
  }

  // pass 2: misplaced where possible
  for (let i=0;i<TILE_COUNT;i++){
    if (states[i] === "correct") continue;
    const ch = guessTiles[i];
    const count = remaining.get(ch) ?? 0;
    if (count > 0){
      states[i] = "misplaced";
      remaining.set(ch, count - 1);
    }
  }

  return states;
}

/* ============================================================
   UI + GAME STATE
============================================================ */
const el = {
  metaLine: document.getElementById("metaLine"),
  xInput: document.getElementById("xInput"),
  genBtn: document.getElementById("genBtn"),
  xPill: document.getElementById("xPill"),
  outputLine: document.getElementById("outputLine"),
  guessInput: document.getElementById("guessInput"),
  guessBtn: document.getElementById("guessBtn"),
  tileGrid: document.getElementById("tileGrid"),
  feedback: document.getElementById("feedback"),
};

let currentDay = todayKey(TZ_NAME);
let secretStr = dailySecret(currentDay);
let secretTiles = secretStr.split("");

let currentX = null;
let targetOutput = null;
let rowIndex = 0;
let roundOver = false;

function updateMeta(){
  el.metaLine.textContent =
    `Daily puzzle • Date: ${currentDay} (${TZ_NAME}) • 8 tiles • 2–3 operations • numbers 1–3 digits • 5 attempts`;
}

function buildEmptyGrid(){
  el.tileGrid.innerHTML = "";
  for (let r=0;r<MAX_GUESSES;r++){
    const row = document.createElement("div");
    row.className = "tileRow";
    for (let c=0;c<TILE_COUNT;c++){
      const t = document.createElement("div");
      t.className = "tile";
      t.textContent = "";
      row.appendChild(t);
    }
    el.tileGrid.appendChild(row);
  }
}

function clearGrid(){
  const rows = el.tileGrid.querySelectorAll(".tileRow");
  rows.forEach(row => {
    row.querySelectorAll(".tile").forEach(tile => {
      tile.className = "tile";
      tile.textContent = "";
    });
  });
}

function paintRow(r, guessTiles, states){
  const row = el.tileGrid.querySelectorAll(".tileRow")[r];
  const tiles = row.querySelectorAll(".tile");
  for (let i=0;i<TILE_COUNT;i++){
    tiles[i].textContent = guessTiles[i].toUpperCase();
    tiles[i].className = "tile " + states[i];
  }
}

function refreshDailyIfNeeded(){
  const newDay = todayKey(TZ_NAME);
  if (newDay !== currentDay){
    currentDay = newDay;
    secretStr = dailySecret(currentDay);
    secretTiles = secretStr.split("");

    // reset state for new day
    currentX = null;
    targetOutput = null;
    rowIndex = 0;
    roundOver = false;

    el.xPill.textContent = "—";
    el.outputLine.textContent = "Output: —";
    el.feedback.textContent = "New daily puzzle loaded. Enter x and generate an output to begin.";
    clearGrid();
    updateMeta();
  }
}

function resetRoundKeepOutput(){
  // IMPORTANT bug-fix pattern: clear guesses before setting output
  rowIndex = 0;
  roundOver = false;
  clearGrid();
}

/* ============================================================
   ACTIONS
============================================================ */
function generateOutput(){
  refreshDailyIfNeeded();

  const raw = el.xInput.value.trim();
  if (!/^-?\d+$/.test(raw)){
    alert("Please enter a whole number for x.");
    return;
  }

  currentX = parseInt(raw, 10);

  // Bug-fix: reset attempts/grid FIRST, then compute output
  resetRoundKeepOutput();

  const {ops, nums} = parseFormulaFromTiles(secretTiles);
  targetOutput = evalLeftToRight(currentX, ops, nums);

  el.xPill.textContent = String(currentX);
  el.outputLine.textContent = `Output: ${targetOutput}`;
  el.feedback.textContent = `Make a guess. You have ${MAX_GUESSES} attempts.`;
  el.guessInput.value = "";
  el.guessInput.focus();
}

function submitGuess(){
  refreshDailyIfNeeded();

  if (targetOutput === null){
    el.feedback.textContent = "Generate an output first.";
    return;
  }
  if (roundOver){
    el.feedback.textContent = "This round is over. Generate a new output to start again.";
    return;
  }
  if (rowIndex >= MAX_GUESSES){
    roundOver = true;
    el.feedback.textContent = `No attempts left. Formula was: ${secretStr}`;
    return;
  }

  let guessTiles;
  try{
    guessTiles = tilesFromGuess(el.guessInput.value);
  }catch(e){
    el.feedback.textContent = e.message;
    return;
  }

  // Validate structure (2–3 ops, 1–3 digit numbers)
  try{
    parseFormulaFromTiles(guessTiles);
  }catch(e){
    el.feedback.textContent = e.message;
    return;
  }

  const states = compareTiles(secretTiles, guessTiles);
  paintRow(rowIndex, guessTiles, states);

  if (guessTiles.join("") === secretStr){
    roundOver = true;
    el.feedback.textContent = `Correct! Solved in ${rowIndex + 1}/${MAX_GUESSES} attempts.`;
    return;
  }

  rowIndex++;
  const remaining = MAX_GUESSES - rowIndex;

  if (remaining === 0){
    roundOver = true;
    el.feedback.textContent = `No attempts left. Formula was: ${secretStr}`;
  } else {
    el.feedback.textContent = `Incorrect. ${remaining} attempts remaining.`;
  }

  el.guessInput.value = "";
  el.guessInput.focus();
}

/* ============================================================
   EVENTS
============================================================ */
el.genBtn.addEventListener("click", generateOutput);
el.guessBtn.addEventListener("click", submitGuess);

el.xInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") generateOutput();
});
el.guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitGuess();
});

/* ============================================================
   INIT
============================================================ */
updateMeta();
buildEmptyGrid();
