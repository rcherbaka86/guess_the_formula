alert("app.js loaded");

(function () {
  "use strict";

  /* =========================
     SETTINGS
  ========================= */
  var ALLOWED_OPS = { "+": true, "-": true, "*": true };
  var TILE_COUNT = 8;
  var MAX_GUESSES = 5;
  var TZ_NAME = "America/New_York";

  /* =========================
     SMALL HELPERS (older-browser safe)
  ========================= */
  function $(id) {
    return document.getElementById(id);
  }

  function safeText(el, text) {
    if (el) el.textContent = text;
  }

  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }

  function normalizeText(s) {
    // Avoid replaceAll for older Safari; use regex
    s = (s || "").trim();
    s = s.replace(/×/g, "*").replace(/−/g, "-");
    s = s.replace(/\s+/g, ""); // remove all whitespace
    return s;
  }

  /* =========================
     DATE (DAILY PUZZLE) — America/New_York
  ========================= */
  function todayKey(tzName) {
    // en-CA gives YYYY-MM-DD format reliably
    var fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tzName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // format() returns YYYY-MM-DD in en-CA
    return fmt.format(new Date());
  }

  /* =========================
     SEEDED RNG
  ========================= */
  function hashStringToUint32(str) {
    // FNV-1a 32-bit
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      var t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, min, max) {
    return Math.floor(rng() * (max - min + 1)) + min; // inclusive
  }

  function randChoice(rng, arr) {
    return arr[randInt(rng, 0, arr.length - 1)];
  }

  /* =========================
     FORMULA PARSING (8 tiles, 2–3 ops, numbers 1–3 digits)
  ========================= */
  function parseFormulaFromTiles(tiles) {
    if (tiles.length !== TILE_COUNT) throw new Error("Internal error: tiles must be length 8.");
    if (tiles[0] !== "x") throw new Error("Formula must start with x.");

    var ops = [];
    var nums = [];
    var i = 1;

    while (i < TILE_COUNT) {
      var op = tiles[i];
      if (!ALLOWED_OPS[op]) throw new Error("Operators allowed are +, -, * (no division).");
      ops.push(op);
      i++;

      if (i >= TILE_COUNT || !isDigit(tiles[i])) throw new Error("Expected a digit after an operator.");

      // Read 1–3 digit number
      var numStr = tiles[i];
      i++;

      if (i < TILE_COUNT && isDigit(tiles[i])) {
        numStr += tiles[i];
        i++;
      }
      if (i < TILE_COUNT && isDigit(tiles[i])) {
        numStr += tiles[i];
        i++;
      }
      if (i < TILE_COUNT && isDigit(tiles[i])) {
        throw new Error("Numbers can only be 1, 2, or 3 digits long.");
      }

      nums.push(parseInt(numStr, 10));
    }

    if (!(ops.length === 2 || ops.length === 3)) throw new Error("Formula must contain 2 or 3 operations.");
    if (nums.length !== ops.length) throw new Error("Internal error: numbers and ops count mismatch.");

    return { ops: ops, nums: nums };
  }

  /* =========================
     FORMULA GENERATION (8 tiles exact)
  ========================= */
  function generateFormulaString(rng) {
    var opsArr = ["+", "-", "*"];

    while (true) {
      var opCount = randChoice(rng, [2, 3]);
      var chars = ["x"];

      for (var k = 0; k < opCount; k++) {
        chars.push(randChoice(rng, opsArr));

        // numbers can be 1–3 digits => 1..999
        var n = randInt(rng, 1, 999);
        var digits = String(n).split("");

        if (chars.length + digits.length > TILE_COUNT) {
          chars = null; // retry
          break;
        }
        for (var d = 0; d < digits.length; d++) chars.push(digits[d]);
      }

      if (!chars || chars.length !== TILE_COUNT) continue;

      var s = chars.join("").toLowerCase();
      try {
        parseFormulaFromTiles(s.split(""));
        return s;
      } catch (_e) {
        continue;
      }
    }
  }

  function dailySecret(dateStr) {
    var seed = hashStringToUint32("daily-v4::tiles8::1to3digits::" + dateStr);
    var rng = mulberry32(seed);
    return generateFormulaString(rng);
  }

  /* =========================
     MATH (left-to-right)
  ========================= */
  function applyOp(a, op, b) {
    if (op === "+") return a + b;
    if (op === "-") return a - b;
    if (op === "*") return a * b;
    throw new Error("Unsupported operator.");
  }

  function evalLeftToRight(x, ops, nums) {
    var v = x;
    for (var i = 0; i < ops.length; i++) v = applyOp(v, ops[i], nums[i]);
    return v;
  }

  /* =========================
     GUESS HANDLING (x implied, exactly 8 chars)
  ========================= */
  function tilesFromGuess(userInput) {
    var s = normalizeText(userInput);
    if (!s) throw new Error("Enter a guess like +8+9 (x is automatic).");

    if (s.charAt(0).toLowerCase() !== "x") s = "x" + s;
    s = s.toLowerCase();

    if (s.length !== TILE_COUNT) {
      throw new Error("Your guess must be exactly " + TILE_COUNT + " characters after adding x. Right now it's " + s.length + ".");
    }
    if (s.charAt(0) !== "x") throw new Error("The first character must be x.");

    return s.split("");
  }

  /* =========================
     TILE FEEDBACK
  ========================= */
  function compareTiles(secretTiles, guessTiles) {
    var states = [];
    for (var i = 0; i < TILE_COUNT; i++) states.push("absent");

    var remaining = {}; // char -> count

    // pass 1
    for (var j = 0; j < TILE_COUNT; j++) {
      if (guessTiles[j] === secretTiles[j]) {
        states[j] = "correct";
      } else {
        var ch = secretTiles[j];
        remaining[ch] = (remaining[ch] || 0) + 1;
      }
    }

    // pass 2
    for (var k = 0; k < TILE_COUNT; k++) {
      if (states[k] === "correct") continue;
      var g = guessTiles[k];
      if ((remaining[g] || 0) > 0) {
        states[k] = "misplaced";
        remaining[g] -= 1;
      }
    }

    return states;
  }

  /* =========================
     UI + STATE
  ========================= */
  var el = {};
  var currentDay, secretStr, secretTiles;
  var currentX = null;
  var targetOutput = null;
  var rowIndex = 0;
  var roundOver = false;

  function updateMeta() {
    safeText(
      el.metaLine,
      "Daily puzzle • Date: " + currentDay + " (" + TZ_NAME + ") • 8 tiles • 2–3 operations • numbers 1–3 digits • 5 attempts"
    );
  }

  function buildEmptyGrid() {
    el.tileGrid.innerHTML = "";
    for (var r = 0; r < MAX_GUESSES; r++) {
      var row = document.createElement("div");
      row.className = "tileRow";
      for (var c = 0; c < TILE_COUNT; c++) {
        var t = document.createElement("div");
        t.className = "tile";
        t.textContent = "";
        row.appendChild(t);
      }
      el.tileGrid.appendChild(row);
    }
  }

  function clearGrid() {
    var rows = el.tileGrid.querySelectorAll(".tileRow");
    for (var r = 0; r < rows.length; r++) {
      var tiles = rows[r].querySelectorAll(".tile");
      for (var c = 0; c < tiles.length; c++) {
        tiles[c].className = "tile";
        tiles[c].textContent = "";
      }
    }
  }

  function paintRow(r, guessTiles, states) {
    var rows = el.tileGrid.querySelectorAll(".tileRow");
    var row = rows[r];
    var tiles = row.querySelectorAll(".tile");
    for (var i = 0; i < TILE_COUNT; i++) {
      tiles[i].textContent = guessTiles[i].toUpperCase();
      tiles[i].className = "tile " + states[i];
    }
  }

  function refreshDailyIfNeeded() {
    var newDay = todayKey(TZ_NAME);
    if (newDay !== currentDay) {
      currentDay = newDay;
      secretStr = dailySecret(currentDay);
      secretTiles = secretStr.split("");

      currentX = null;
      targetOutput = null;
      rowIndex = 0;
      roundOver = false;

      safeText(el.xPill, "—");
      safeText(el.outputLine, "Output: —");
      safeText(el.feedback, "New daily puzzle loaded. Enter x and generate an output to begin.");
      clearGrid();
      updateMeta();
    }
  }

  function resetRoundKeepOutput() {
    rowIndex = 0;
    roundOver = false;
    clearGrid();
  }

  /* =========================
     ACTIONS
  ========================= */
  function generateOutput() {
    refreshDailyIfNeeded();

    var raw = (el.xInput.value || "").trim();
    if (!/^-?\d+$/.test(raw)) {
      alert("Please enter a whole number for x.");
      return;
    }
    currentX = parseInt(raw, 10);

    // Bug-fix pattern: clear guesses FIRST, then compute output
    resetRoundKeepOutput();

    var parsed = parseFormulaFromTiles(secretTiles);
    targetOutput = evalLeftToRight(currentX, parsed.ops, parsed.nums);

    safeText(el.xPill, String(currentX));
    safeText(el.outputLine, "Output: " + targetOutput);
    safeText(el.feedback, "Make a guess. You have " + MAX_GUESSES + " attempts.");
    el.guessInput.value = "";
    el.guessInput.focus();
  }

  function submitGuess() {
    refreshDailyIfNeeded();

    if (targetOutput === null) {
      safeText(el.feedback, "Generate an output first.");
      return;
    }
    if (roundOver) {
      safeText(el.feedback, "This round is over. Generate a new output to start again.");
      return;
    }
    if (rowIndex >= MAX_GUESSES) {
      roundOver = true;
      safeText(el.feedback, "No attempts left. Formula was: " + secretStr);
      return;
    }

    var guessTiles;
    try {
      guessTiles = tilesFromGuess(el.guessInput.value);
    } catch (e1) {
      safeText(el.feedback, e1.message);
      return;
    }

    try {
      parseFormulaFromTiles(guessTiles);
    } catch (e2) {
      safeText(el.feedback, e2.message);
      return;
    }

    var states = compareTiles(secretTiles, guessTiles);
    paintRow(rowIndex, guessTiles, states);

    if (guessTiles.join("") === secretStr) {
      roundOver = true;
      safeText(el.feedback, "Correct! Solved in " + (rowIndex + 1) + "/" + MAX_GUESSES + " attempts.");
      return;
    }

    rowIndex++;
    var remaining = MAX_GUESSES - rowIndex;

    if (remaining === 0) {
      roundOver = true;
      safeText(el.feedback, "No attempts left. Formula was: " + secretStr);
    } else {
      safeText(el.feedback, "Incorrect. " + remaining + " attempts remaining.");
    }

    el.guessInput.value = "";
    el.guessInput.focus();
  }

  /* =========================
     INIT
  ========================= */
  function init() {
    // Grab elements
    el.metaLine = $("metaLine");
    el.xInput = $("xInput");
    el.genBtn = $("genBtn");
    el.xPill = $("xPill");
    el.outputLine = $("outputLine");
    el.guessInput = $("guessInput");
    el.guessBtn = $("guessBtn");
    el.tileGrid = $("tileGrid");
    el.feedback = $("feedback");

    // Basic validation
    if (!el.genBtn || !el.guessBtn || !el.tileGrid) {
      // If this happens, IDs don't match index.html
      return;
    }

    // Seed daily
    currentDay = todayKey(TZ_NAME);
    secretStr = dailySecret(currentDay);
    secretTiles = secretStr.split("");

    updateMeta();
    buildEmptyGrid();

    // Wire events
    el.genBtn.addEventListener("click", generateOutput);
    el.guessBtn.addEventListener("click", submitGuess);

    el.xInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") generateOutput();
    });
    el.guessInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submitGuess();
    });
  }

  // Catch errors and show them in the UI (better than “buttons do nothing”)
  window.addEventListener("error", function (e) {
    try {
      var fb = $("feedback");
      if (fb) fb.textContent = "JavaScript error: " + (e.message || "Unknown error");
    } catch (_ignore) {}
  });

  document.addEventListener("DOMContentLoaded", function () {
    try {
      init();
    } catch (e) {
      var fb = $("feedback");
      if (fb) fb.textContent = "Init error: " + e.message;
    }
  });
})();
