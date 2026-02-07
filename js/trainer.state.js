// Shared mutable state for the premove trainer.
// This file must be loaded after chess.js (Chess global).

let game = new Chess();
let board = null;
let moveHistory = [];
let whiteTime = 5.0;
let blackTime = 60.0;
let initialWhiteTime = 5.0;
let initialBlackTime = 60.0;
let timerInterval = null;
let premoves = [];
let blackMoveDelay = 1.0;
let blackMoveTimeout = null;
let currentScenario = 'kq';
let customFen = '';
let premoveAutoPending = false;
let premoveAutoTimeout = null;
let dragStartedOnTurn = null;
let dragStartedAtMs = 0;
let lastDragSource = null;
