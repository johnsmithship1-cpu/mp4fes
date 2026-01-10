/**
 * Rhythm Game Core Engine
 */

class GameEngine {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.gameState = 'menu'; // menu, song-select, playing, result
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;

        this.notes = [];
        this.targetPoints = [];
        this.numTargets = 6;

        this.lastTime = 0;
        this.startTime = 0;
        this.isPlaying = false;

        this.stats = {
            perfect: 0,
            great: 0,
            good: 0,
            miss: 0
        };

        // Input Tracking
        // Map<identifier, targetIdx>
        this.activeTouches = new Map();

        // Audio Analysis
        this.audioCtx = null;
        this.analyser = null;
        this.source = null;
        this.video = document.getElementById('game-video');
        this.currentFile = null;

        this.init();
    }

    init() {
        this.log("Initializing GameEngine...");
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupTargets();
        this.bindEvents();
        this.renderLoop();
    }

    log(msg) {
        const logger = document.getElementById('debug-log');
        if (logger) {
            logger.innerText = msg + "\n" + logger.innerText;
        }
        console.log("[RhythmGame] " + msg);
    }

    initAudio() {
        if (this.audioCtx) return;
        this.log("Attempting to init AudioContext...");
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) {
                this.log("Error: AudioContext not supported");
                return;
            }
            this.audioCtx = new AudioContext();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;

            if (!this.video) {
                this.log("Error: game-video element not found");
                return;
            }

            this.source = this.audioCtx.createMediaElementSource(this.video);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);
            this.log("AudioContext initialized successfully");
        } catch (e) {
            this.log("Audio init error: " + e.message);
        }
    }

    resize() {
        const container = document.getElementById('game-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.setupTargets(); // Re-calculate points on resize
    }

    setupTargets() {
        this.targetPoints = [];
        const width = this.canvas.width;
        const height = this.canvas.height;

        // 半円状に9つのポイントを配置
        // 中心(横中央, 上から少し)から放射状に広がる
        const centerX = width / 2;
        const centerY = height * 0.2;
        const radius = Math.min(width, height) * 0.7;

        const targetColors = ['#2196F3', '#9C27B0', '#F44336', '#E91E63', '#FFEB3B', '#4CAF50'];

        for (let i = 0; i < this.numTargets; i++) {
            // 角度: 180度を分割 (6個の場合はより広く配置)
            const angle = Math.PI + (Math.PI / (this.numTargets - 1)) * i;
            this.targetPoints.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY - Math.sin(angle) * radius,
                angle: angle,
                color: targetColors[i % targetColors.length]
            });
        }
    }

    bindEvents() {
        document.getElementById('start-btn').onclick = () => {
            this.log("GAME START clicked");
            this.initAudio();
            this.switchScreen('song-select');
        };
        document.getElementById('back-to-menu').onclick = () => {
            this.log("BACK clicked");
            if (this.video) this.video.pause();
            this.switchScreen('menu');
        };
        document.getElementById('play-btn').onclick = () => {
            this.log("PLAY clicked");
            if (this.currentFile) this.startGame();
            else {
                this.log("Error: No file selected");
                alert('Please select an MP4 file first!');
            }
        };
        document.getElementById('restart-btn').onclick = () => this.startGame();
        document.getElementById('quit-btn').onclick = () => {
            if (this.video) this.video.pause();
            this.switchScreen('menu');
        }

        const upload = document.getElementById('video-upload');
        upload.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.currentFile = file;
                document.getElementById('file-name').innerText = file.name;
                this.video.src = URL.createObjectURL(file);
                this.video.load();
            }
        };

        // Updated Input Listeners
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        this.canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        // this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
    }

    switchScreen(screenName) {
        this.gameState = screenName;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

        let screenId = `${screenName}-screen`;
        if (screenName === 'playing') screenId = 'hud';
        if (screenName === 'song-select') screenId = 'song-selection-screen';

        const el = document.getElementById(screenId);
        if (el) el.classList.add('active');

        if (screenName === 'playing') {
            this.isPlaying = true;
        } else {
            this.isPlaying = false;
        }
    }

    startGame() {
        this.initAudio();
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.notes = [];
        this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
        this.activeTouches.clear();
        this.updateHUD();
        this.switchScreen('playing');

        this.video.classList.add('visible');
        this.video.currentTime = 0;

        // Ensure video is ready to play
        const playPromise = this.video.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Playback failed:", error);
                // Auto-retry if needed or show user message
            });
        }
        this.startTime = performance.now();

        this.lastAnalysisTime = 0;
        this.beatThreshold = 180; // 音量しきい値
        this.minBeatInterval = 200; // 次のノーツまでの最小間隔(ms)
    }

    // -------------------------------------------------------------------------
    // Note Management
    // -------------------------------------------------------------------------

    spawnNote() {
        const spawnTime = performance.now() - this.startTime;
        const travelDuration = 1500; // 1.5秒で到達

        const rand = Math.random();

        // Target index randomization helper
        const getRandomTarget = (exclude = []) => {
            let idx;
            do {
                idx = Math.floor(Math.random() * this.numTargets);
            } while (exclude.includes(idx));
            return idx;
        };

        if (rand < 0.15) {
            // --- Simultaneous (Double) Note ---
            const target1 = getRandomTarget();
            const target2 = getRandomTarget([target1]);

            this.addNote(target1, spawnTime, travelDuration, 'normal', 0, true);
            this.addNote(target2, spawnTime, travelDuration, 'normal', 0, true);

        } else if (rand < 0.3) {
            // --- Long Note ---
            const target = getRandomTarget();
            const holdDuration = 500 + Math.random() * 1000; // 0.5s - 1.5s
            this.addNote(target, spawnTime, travelDuration, 'long', holdDuration);

        } else {
            // --- Normal Note ---
            const target = getRandomTarget();
            this.addNote(target, spawnTime, travelDuration, 'normal');
        }
    }

    addNote(targetIdx, spawnTime, duration, type, holdDuration = 0, isSimultaneous = false) {
        this.notes.push({
            targetIdx,
            spawnTime,
            duration, // Travel time
            type, // 'normal' | 'long'
            holdDuration,
            isHolding: false,
            isSimultaneous,
            processed: false // If 'long', processed means "finished successfully"
        });
    }

    updateHUD() {
        document.getElementById('score-val').innerText = String(this.score).padStart(7, '0');
        document.getElementById('combo-val').innerText = this.combo;
        const comboContainer = document.querySelector('.combo-container');
        if (this.combo > 0) comboContainer.classList.add('visible');
        else comboContainer.classList.remove('visible');
    }

    showJudgment(text) {
        const el = document.getElementById('judgment-text');
        el.innerText = text;
        el.style.color = `var(--${text.toLowerCase()})`;
        // Reset animation
        el.style.animation = 'none';
        el.offsetHeight; // trigger reflow
        el.style.animation = null;
    }

    // -------------------------------------------------------------------------
    // Input Handling
    // -------------------------------------------------------------------------

    getHitTargetIdx(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        let closestIdx = -1;
        let minDist = 60; // Slightly larger hit area

        this.targetPoints.forEach((pt, idx) => {
            const d = Math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2);
            if (d < minDist) {
                minDist = d;
                closestIdx = idx;
            }
        });
        return closestIdx;
    }

    handleTouchStart(e) {
        e.preventDefault();
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            const targetIdx = this.getHitTargetIdx(t.clientX, t.clientY);
            if (targetIdx !== -1) {
                this.activeTouches.set(t.identifier, targetIdx);
                this.checkHit(targetIdx);
            }
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            const targetIdx = this.getHitTargetIdx(t.clientX, t.clientY);

            // Check if finger moved to a DIFFERENT target
            const prevTarget = this.activeTouches.get(t.identifier);
            if (targetIdx !== -1 && targetIdx !== prevTarget) {
                this.activeTouches.set(t.identifier, targetIdx);
                // Sliding onto a new target acts like a press for new notes (optional playstyle)
                // For now, let's just track it for holding purposes
            } else if (targetIdx === -1) {
                this.activeTouches.delete(t.identifier);
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        const touches = e.changedTouches;
        for (let i = 0; i < touches.length; i++) {
            const t = touches[i];
            this.activeTouches.delete(t.identifier);
        }
    }

    // Mouse abstraction
    handleMouseDown(e) {
        const targetIdx = this.getHitTargetIdx(e.clientX, e.clientY);
        if (targetIdx !== -1) {
            this.activeTouches.set('mouse', targetIdx);
            this.checkHit(targetIdx);
        }
    }
    handleMouseMove(e) {
        const targetIdx = this.getHitTargetIdx(e.clientX, e.clientY);
        if (targetIdx !== -1) {
            // If currently holding mouse, update target?
            // Simple mouse implementation: click only
            if (this.activeTouches.has('mouse')) {
                this.activeTouches.set('mouse', targetIdx);
            }
        } else {
            if (this.activeTouches.has('mouse')) {
                this.activeTouches.delete('mouse'); // Lost focus
            }
        }
    }
    handleMouseUp(e) {
        this.activeTouches.delete('mouse');
    }

    // Is a target currently being held?
    isTargetHeld(targetIdx) {
        for (let val of this.activeTouches.values()) {
            if (val === targetIdx) return true;
        }
        return false;
    }

    checkHit(targetIdx) {
        if (!this.isPlaying) return;

        const now = performance.now() - this.startTime;
        const hitWindow = 150; // ms

        // Find nearest unprocessed note on this target
        // For Long notes, this is the "Start" hit.
        let foundNote = null;

        // Priority: Find closest Note in time
        let minDiff = Infinity;

        for (let note of this.notes) {
            if (note.targetIdx === targetIdx && !note.processed && !note.isHolding) {
                // If it's a long note already holding, we don't trigger "Hit" again on it (it's handled in update)
                const diff = Math.abs(now - (note.spawnTime + note.duration));
                if (diff < hitWindow && diff < minDiff) {
                    minDiff = diff;
                    foundNote = note;
                }
            }
        }

        if (foundNote) {
            let judgment = 'MISS';
            if (minDiff < 50) judgment = 'PERFECT';
            else if (minDiff < 100) judgment = 'GREAT';
            else judgment = 'GOOD';

            if (foundNote.type === 'long') {
                foundNote.isHolding = true;
                this.showJudgment(judgment); // Show initial judgment
                // Don't modify combo/score yet? 
                // Standard: Add combo on start, then tick, then end.
                // Simple: Add combo/score on start
                this.applyJudgment(judgment, false); // false = don't reset combo on miss if handled elsewhere, but here it's fine.
            } else {
                foundNote.processed = true;
                this.applyJudgment(judgment);
            }
        }
    }

    applyJudgment(judgment, countStats = true) {
        this.showJudgment(judgment);

        if (judgment === 'MISS') {
            this.combo = 0;
            if (countStats) this.stats.miss++;
        } else {
            this.combo++;
            this.maxCombo = Math.max(this.combo, this.maxCombo);

            let baseScore = 0;
            if (judgment === 'PERFECT') {
                baseScore = 1000;
                if (countStats) this.stats.perfect++;
            } else if (judgment === 'GREAT') {
                baseScore = 750;
                if (countStats) this.stats.great++;
            } else { // GOOD
                baseScore = 500;
                if (countStats) this.stats.good++;
            }
            this.score += baseScore + this.combo * 10;
        }
        this.updateHUD();
    }

    renderLoop(time) {
        const deltaTime = time - this.lastTime;
        this.lastTime = time;

        this.update(time);
        this.draw();

        requestAnimationFrame((t) => this.renderLoop(t));
    }

    update(time) {
        if (!this.isPlaying) return;

        const now = time - this.startTime;

        // --- Audio Analysis Spawning ---
        if (this.analyser) {
            const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.analyser.getByteFrequencyData(dataArray);

            let energy = 0;
            for (let i = 0; i < 5; i++) energy += dataArray[i];
            energy /= 5;

            if (energy > this.beatThreshold && now - this.lastAnalysisTime > this.minBeatInterval) {
                this.spawnNote();
                this.lastAnalysisTime = now;
            }
        }

        // --- Note Logic ---
        this.notes.forEach(note => {
            if (note.processed) return;

            const arrTime = note.spawnTime + note.duration;
            const endTime = arrTime + (note.type === 'long' ? note.holdDuration : 0);

            // 1. Check Miss (Passed without hit)
            if (!note.isHolding) {
                // Determine miss threshold. Normal: arrTime + window. Long: same for start.
                if (now > arrTime + 150) {
                    note.processed = true;
                    this.applyJudgment('MISS');
                }
            }
            // 2. Handle Long Note Holding
            else if (note.type === 'long' && note.isHolding) {
                // Must continue holding
                if (!this.isTargetHeld(note.targetIdx)) {
                    // Released early!
                    note.processed = true;
                    this.applyJudgment('MISS');
                } else {
                    // Check if reached end
                    if (now >= endTime) {
                        note.processed = true;
                        this.applyJudgment('PERFECT'); // Completed hold
                    } else {
                        // Optional: Add score ticks while holding
                        if (Math.random() < 0.1) this.score += 10;
                    }
                }
            }
        });

        // Cleanup processed notes
        this.notes = this.notes.filter(n => !n.processed || (performance.now() - this.startTime < n.spawnTime + n.duration + n.holdDuration + 1000));

        // 終了判定
        if (this.video.ended) {
            this.endGame();
        }
    }

    endGame() {
        this.isPlaying = false;
        this.video.pause();
        this.video.classList.remove('visible');

        document.getElementById('res-perfect').innerText = this.stats.perfect;
        document.getElementById('res-great').innerText = this.stats.great;
        document.getElementById('res-good').innerText = this.stats.good;
        document.getElementById('res-miss').innerText = this.stats.miss;
        document.getElementById('res-score').innerText = this.score;

        this.switchScreen('result');
    }

    draw() {
        const { ctx, canvas } = this;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const centerX = canvas.width / 2;
        const centerY = canvas.height * 0.2;

        // Background lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 2;
        this.targetPoints.forEach(pt => {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(pt.x, pt.y);
            ctx.stroke();
        });

        // Targets
        this.targetPoints.forEach((pt, idx) => {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 40, 0, Math.PI * 2);
            ctx.strokeStyle = pt.color;
            ctx.lineWidth = 3;
            ctx.stroke();

            // Inner fill (highlight if held)
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 35, 0, Math.PI * 2);
            if (this.isTargetHeld(idx)) {
                ctx.fillStyle = pt.color + '88'; // Bright if held
            } else {
                ctx.fillStyle = pt.color + '33';
            }
            ctx.fill();
        });

        if (this.isPlaying) {
            const now = performance.now() - this.startTime;

            // Draw connecting lines for simultaneous notes
            // Naive loop: find pairs with same spawn time
            // To avoid double drawing, we can sort or just iterate carefully.
            // But since N is small, n^2 check is fine.
            ctx.lineWidth = 4;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            for (let i = 0; i < this.notes.length; i++) {
                for (let j = i + 1; j < this.notes.length; j++) {
                    const n1 = this.notes[i];
                    const n2 = this.notes[j];
                    // Only active notes
                    if (n1.processed || n2.processed) continue;

                    if (Math.abs(n1.spawnTime - n2.spawnTime) < 10) {
                        // It's a pair! Calculate positions.
                        const p1 = this.getNotePosition(n1, now, centerX, centerY);
                        const p2 = this.getNotePosition(n2, now, centerX, centerY);
                        if (p1 && p2) {
                            ctx.beginPath();
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                            ctx.stroke();
                        }
                    }
                }
            }

            // Draw Notes
            // Draw Long Note Bodies first (so they are under heads)
            this.notes.forEach(note => {
                if (note.processed) return;

                if (note.type === 'long') {
                    this.drawLongNoteBody(ctx, note, now, centerX, centerY);
                }
            });

            // Draw Heads
            this.notes.forEach(note => {
                if (note.processed) return;
                this.drawNoteHead(ctx, note, now, centerX, centerY);
            });
        }
    }

    getNotePosition(note, now, cx, cy) {
        // Position based on current time relative to spawn->arrival
        // arrival time = spawnTime + duration
        // Note: For long note body, we need positions even if > 1.0

        const elapsed = now - note.spawnTime;
        const progress = elapsed / note.duration;

        // Don't draw if too far away or behind
        // if (progress < 0 || progress > 1.5) return null;

        const target = this.targetPoints[note.targetIdx];
        const x = cx + (target.x - cx) * progress;
        const y = cy + (target.y - cy) * progress;
        return { x, y, progress, color: target.color };
    }

    drawNoteHead(ctx, note, now, cx, cy) {
        // If holding, head should stick to target?
        // Or just disappear? usually it stays at the target visualizing the hold start

        let pos;
        if (note.isHolding) {
            // Stick to target
            const target = this.targetPoints[note.targetIdx];
            pos = { x: target.x, y: target.y, color: target.color };
        } else {
            pos = this.getNotePosition(note, now, cx, cy);
        }

        if (!pos) return;
        // Don't draw if not visible yet (progress < 0) or way passed
        // But getNotePosition handles basic calc.

        // Simple bounds check for visibility
        if (pos.progress > 1.2 && !note.isHolding) return;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 30, 0, Math.PI * 2);

        // NO FILL for any notes

        ctx.lineWidth = 5;
        ctx.strokeStyle = pos.color;
        ctx.stroke();

        // Horizontal Bar for Simultaneous
        if (note.isSimultaneous) {
            ctx.beginPath();
            ctx.moveTo(pos.x - 20, pos.y);
            ctx.lineTo(pos.x + 20, pos.y);
            ctx.lineWidth = 5;
            ctx.strokeStyle = pos.color;
            ctx.stroke();
        }
    }

    drawLongNoteBody(ctx, note, now, cx, cy) {
        // Head position (or Target if holding)
        let headPos;
        const target = this.targetPoints[note.targetIdx];

        if (note.isHolding) {
            headPos = { x: target.x, y: target.y };
        } else {
            headPos = this.getNotePosition(note, now, cx, cy);
        }

        // Tail position
        const elapsed = now - note.spawnTime; // Time since head spawn

        const headProgress = note.isHolding ? 1.0 : (elapsed / note.duration);
        const tailProgress = (elapsed - note.holdDuration) / note.duration;

        const startP = Math.max(0, tailProgress);
        const endP = Math.min(headProgress, 1.0); // Clamp to target if holding

        if (startP >= endP) return; // Nothing to draw

        // Calculate coordinates
        const startX = cx + (target.x - cx) * startP;
        const startY = cy + (target.y - cy) * startP;

        const endX = cx + (target.x - cx) * endP;
        const endY = cy + (target.y - cy) * endP;

        // Draw Line (Body)
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineWidth = 20; // Thinner than head
        ctx.strokeStyle = target.color + 'AA'; // Semi-transparent
        ctx.lineCap = 'round';
        ctx.stroke();

        // Draw Tail Circle
        if (tailProgress > 0 && tailProgress < 1.05) {
            ctx.beginPath();
            ctx.arc(startX, startY, 15, 0, Math.PI * 2);
            ctx.fillStyle = target.color;
            ctx.fill();
        }
    }
}

window.onload = () => {
    window.game = new GameEngine();
};
