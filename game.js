window.onerror = function (msg, url, line, col, error) {
    console.error(`ERR: ${msg} at ${line}:${col}`);
    return false;
};

class GameEngine {
    constructor() {
        try {
            this.canvas = document.getElementById('game-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.gameState = 'menu';
            this.score = 0;
            this.combo = 0;
            this.maxCombo = 0;
            this.notes = [];
            this.targetPoints = [];
            this.numTargets = 6;
            this.lastTime = 0;
            this.startTime = 0;
            this.isPlaying = false;
            this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
            this.maxHP = 100;
            this.currentHP = 100;
            this.effects = []; // Visual effects for hits
            this.particles = []; // Particle effects
            this.spawnedNoteCount = 0; // DEBUG: track actual spawned notes

            // Audio
            this.audioCtx = null;
            this.analyser = null;
            this.video = document.getElementById('game-video');
            this.currentFile = null;
            this.tapSoundBuffer = null;
            this.tapSoundAudio = null;

            // Input Tracking
            this.activeTouches = new Map();

            // Analysis
            this.lastAnalysisTime = 0;
            this.beatThreshold = 140;
            this.minBeatInterval = 250;
            this.lastAnalysisTime = 0;
            this.avgEnergy = 0;
            this.lastEnergy = 0;

            // Settings
            this.difficulty = 'normal';
            this.isPaused = false;

            this.analysisData = null; // Stores totalNotes and maxScore

            this.init();
        } catch (e) { console.error(e); }
    }

    init() {
        this.log("Initializing...");
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupTargets();
        this.bindEvents();
        this.renderLoop();
    }

    log(msg) {
        console.log("[RhythmGame] " + msg);
    }

    initAudio() {
        if (this.audioCtx) return;
        this.log("Init Audio...");
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8; // Match restoration point (default)
            this.video.crossOrigin = "anonymous";
            this.source = this.audioCtx.createMediaElementSource(this.video);

            // Create GainNode for volume control
            this.gainNode = this.audioCtx.createGain();
            this.gainNode.gain.value = 0.5; // Set to 50%

            this.source.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            this.analyser.connect(this.audioCtx.destination);

            this.loadTapSound();
            this.log("Audio OK");
        } catch (e) {
            this.log("Audio fail: " + e.message);
        }
    }

    loadTapSound() {
        try {
            const audio = new Audio('SleighBells.mp3');
            audio.addEventListener('canplaythrough', () => {
                this.tapSoundAudio = audio;
                this.log("Tap sound loaded");
            });
            audio.load();
        } catch (e) {
            this.log("Tap sound error: " + e.message);
        }
    }

    playTapSound() {
        // Sound disabled as per request
        return;
    }

    resize() {
        const container = document.getElementById('game-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.setupTargets();
    }

    setupTargets() {
        this.targetPoints = [];
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height * 0.2;
        const radius = Math.min(this.canvas.width, this.canvas.height) * 0.7;
        const colors = ['#2196F3', '#9C27B0', '#FF0000', '#E91E63', '#FFEB3B', '#4CAF50'];
        const startAngle = Math.PI + 0.2;
        const endAngle = Math.PI * 2 - 0.2;
        for (let i = 0; i < this.numTargets; i++) {
            const angle = startAngle + ((endAngle - startAngle) / (this.numTargets - 1)) * i;
            this.targetPoints.push({
                x: centerX + Math.cos(angle) * radius,
                y: centerY - Math.sin(angle) * radius,
                color: colors[i]
            });
        }
    }

    bindEvents() {
        document.getElementById('speed-input').onchange = () => {
            if (this.currentFile) this.analyzeAudio(this.currentFile);
        };
        document.getElementById('interval-input').onchange = () => {
            if (this.currentFile) this.analyzeAudio(this.currentFile);
        };

        document.getElementById('start-btn').onclick = () => {
            this.initAudio();
            this.switchScreen('song-select');
        };
        document.getElementById('back-to-menu').onclick = () => {
            if (this.video) { this.video.pause(); this.video.currentTime = 0; }
            this.switchScreen('menu');
        };
        // Play button removed, triggered via startGame('diff')

        document.getElementById('pause-btn').onclick = () => this.togglePause();
        document.getElementById('resume-btn').onclick = () => this.togglePause();
        document.getElementById('pause-retry-btn').onclick = () => {
            this.togglePause(); // Unpause logic to reset state properly
            this.startGame();
        };
        document.getElementById('pause-menu-btn').onclick = () => {
            this.togglePause();
            this.endGame(); // Or switchScreen('menu')
            this.switchScreen('menu');
        };

        // Result Screen Buttons
        document.getElementById('restart-btn').onclick = () => {
            this.startGame();
        };
        document.getElementById('quit-btn').onclick = () => {
            // this.video.pause(); // already paused in endGame
            this.switchScreen('menu');
        };

        const upload = document.getElementById('video-upload');
        upload.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.currentFile = file;
                document.getElementById('file-name').innerText = file.name;
                this.video.src = URL.createObjectURL(file);
                this.video.load();
                this.analyzeAudio(file);
            }
        };

        const canvas = this.canvas;
        canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
        canvas.addEventListener('touchcancel', (e) => this.handleTouchEnd(e), { passive: false });

        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    switchScreen(screenName) {
        this.gameState = screenName;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        let sid = screenName + '-screen';
        if (screenName === 'playing') sid = 'hud';
        if (screenName === 'song-select') sid = 'song-selection-screen';
        document.getElementById(sid)?.classList.add('active');
        this.isPlaying = (screenName === 'playing');

        // Hide Pause Screen if open
        document.getElementById('pause-screen').classList.remove('active');
    }

    async startGame() {
        if (!this.currentFile) {
            alert("Please select an MP4 file first!");
            return;
        }

        // Wait for analysis if in progress
        if (!this.analysisData) {
            document.getElementById('analysis-overlay').style.display = 'flex';
            document.getElementById('analysis-status').innerText = "Waiting for analysis...";
            if (this.isAnalyzing) {
                while (this.isAnalyzing) await new Promise(r => requestAnimationFrame(r));
            } else {
                await this.analyzeAudio(this.currentFile);
            }
        }
        document.getElementById('analysis-overlay').style.display = 'none';

        // Read settings
        this.noteDuration = parseFloat(document.getElementById('speed-input').value) * 1000;
        this.minBeatInterval = parseInt(document.getElementById('interval-input').value);

        this.log(`Start Game: Speed=${this.noteDuration}ms, Interval=${this.minBeatInterval}ms`);

        this.initAudio();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        this.score = 0; this.combo = 0; this.maxCombo = 0;
        this.notes = [];
        this.spawnedNoteCount = 0;
        this.stats = { perfect: 0, great: 0, good: 0, miss: 0 };
        this.currentHP = this.maxHP;

        // Use Pre-analyzed Score Target
        if (this.analysisData) {
            this.scoreTarget = this.analysisData.targetScore;
            console.log(`Using Analyzed Target: ${this.scoreTarget} (Notes: ${this.analysisData.totalNotes})`);
        } else {
            // Fallback to dynamic estimate
            let duration = this.video.duration;
            if (isNaN(duration) || duration === Infinity) duration = 180;
            const intervalSec = this.minBeatInterval / 1000;
            const estimatedNotes = Math.floor((duration / intervalSec) * 0.6);
            const maxScore = (estimatedNotes * 1000) + (10 * (estimatedNotes * (estimatedNotes + 1) / 2));
            this.scoreTarget = Math.floor(maxScore * 0.9);
        }

        this.activeTouches.clear();
        this.isPaused = false;

        // Reset Detection State for Sync
        this.avgEnergy = 0;
        this.lastAnalysisTime = 0;

        // Initialize Chart for playback
        if (this.analysisData && this.analysisData.noteChart) {
            this.currentChart = [...this.analysisData.noteChart];
            console.log(`Chart Loaded: ${this.currentChart.length} beats`);
        } else {
            this.currentChart = [];
        }

        this.updateHUD(); // Initial Reset
        this.switchScreen('playing');

        this.video.classList.add('visible');
        this.video.currentTime = 0;
        this.video.volume = 0.5;
        this.video.play().catch(e => this.log("Play err: " + e.message));

        this.startTime = performance.now();
        this.lastAnalysisTime = 0;
        this.avgEnergy = 0;
    }

    async analyzeAudio(file) {
        this.initAudio(); // Ensure audio context exists
        this.log("Starting analysis: " + file.name);
        this.isAnalyzing = true;
        document.getElementById('analysis-overlay').style.display = 'flex';
        document.getElementById('analysis-status').innerText = "Analyzing audio...";
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            this.handleBeatDetection(audioBuffer);
        } catch (e) {
            this.log("Analysis failed: " + e.message);
            alert("Audio analysis failed. Please try another file.");
            document.getElementById('analysis-overlay').style.display = 'none';
        } finally {
            this.isAnalyzing = false;
        }
    }

    handleBeatDetection(audioBuffer) {
        this.log("Processing audio data...");
        const rawData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const duration = audioBuffer.duration;

        // Settings for detection
        const fps = 60;
        const samplesPerFrame = Math.floor(sampleRate / fps);
        const totalFrames = Math.floor(rawData.length / samplesPerFrame);

        // Energy Profile
        let energies = [];
        for (let i = 0; i < totalFrames; i++) {
            let sum = 0;
            const start = i * samplesPerFrame;
            for (let j = 0; j < samplesPerFrame; j++) {
                if (start + j < rawData.length) {
                    sum += rawData[start + j] * rawData[start + j];
                }
            }
            energies.push(Math.sqrt(sum / samplesPerFrame));
        }

        // Calculate Threshold (Dynamic)
        // Simple local average window
        const windowSize = 40; // ~0.6s
        let beats = [];

        for (let i = windowSize; i < energies.length - windowSize; i++) {
            let localSum = 0;
            for (let k = -windowSize; k <= windowSize; k++) {
                localSum += energies[i + k];
            }
            const localAvg = localSum / (windowSize * 2 + 1);
            const c = 1.3; // Threshold multiplier sensitivity

            if (energies[i] > localAvg * c && energies[i] > 0.01) {
                // Peak check
                if (energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
                    // Check min interval
                    const time = i / fps;
                    // convert user setting ms to sec
                    const minInterval = (this.minBeatInterval || 250) / 1000;

                    if (beats.length === 0 || (time * 1000 - beats[beats.length - 1].time) > (this.minBeatInterval || 250)) {
                        beats.push({
                            time: time * 1000,
                            intensity: energies[i],
                            isSimul: false // Calculated later
                        });
                    }
                }
            }
        }

        // Post-process for simultaneous notes (Dynamic Threshold)
        if (beats.length > 0) {
            const intensities = beats.map(b => b.intensity).sort((a, b) => a - b);
            const simulThreshold = intensities[Math.floor(intensities.length * 0.8)] || 0.3; // Top 20%

            beats.forEach(b => {
                b.isSimul = b.intensity > simulThreshold;
            });
        }

        this.log(`Analysis complete. Found ${beats.length} beats.`);

        const totalNotes = beats.length;
        const maxScore = (totalNotes * 1000) + (10 * (totalNotes * (totalNotes + 1) / 2));

        this.analysisData = {
            noteChart: beats,
            totalNotes: totalNotes,
            maxScore: maxScore,
            targetScore: Math.floor(maxScore * 0.9),
            perfectScore: maxScore
        };

        document.getElementById('analysis-overlay').style.display = 'none';
        document.getElementById('analysis-status').innerText = "Analysis Complete!";
    }

    togglePause() {
        if (!this.isPlaying) return;
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.video.pause();
            this.audioCtx.suspend();
            document.getElementById('pause-screen').classList.add('active');
        } else {
            this.video.play();
            this.audioCtx.resume();
            document.getElementById('pause-screen').classList.remove('active');
            this.lastTime = performance.now(); // Avoid huge delta
        }
    }

    spawnNote(intensity, isSimul) {
        // Find a random target
        // For simple logic, just random
        let idx = Math.floor(Math.random() * this.numTargets);

        // Avoid repeating too much (simple anti-repetition)
        if (this.lastSpawnIdx === idx) {
            idx = (idx + 1) % this.numTargets;
        }
        this.lastSpawnIdx = idx;

        this.addNote(idx, isSimul);
        if (isSimul) {
            let idx2 = (idx + Math.floor(this.numTargets / 2)) % this.numTargets;
            this.addNote(idx2, true); // Mark both as simultaneous
        }
    }

    addNote(targetIdx, isSimul) {
        const note = {
            targetIdx: targetIdx,
            spawnTime: (performance.now() - this.startTime),
            duration: this.noteDuration,
            isSimultaneous: isSimul,
            processed: false
        };
        this.notes.push(note);
        this.spawnedNoteCount++;
    }

    isTargetHeld(targetIdx) {
        for (let idx of this.activeTouches.values()) {
            if (idx === targetIdx) return true;
        }
        return false;
    }

    getHitTargetIdx(e) {
        const rect = this.canvas.getBoundingClientRect();
        let x, y;

        if (e.changedTouches) {
            // Touch
            x = e.changedTouches[0].clientX - rect.left;
            y = e.changedTouches[0].clientY - rect.top;
        } else {
            // Mouse
            x = e.clientX - rect.left;
            y = e.clientY - rect.top;
        }

        // Simple distance check
        for (let i = 0; i < this.targetPoints.length; i++) {
            const p = this.targetPoints[i];
            const dist = Math.sqrt((x - p.x) ** 2 + (y - p.y) ** 2);
            if (dist < 60) return i; // Hit radius
        }
        return -1;
    }

    handleTouchStart(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const idx = this.getHitTargetIdx({ changedTouches: [t] });
            if (idx !== -1) {
                this.activeTouches.set(t.identifier, idx);
                this.handleTap(idx);
            }
        }
    }

    handleTouchMove(e) { e.preventDefault(); }

    handleTouchEnd(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            this.activeTouches.delete(e.changedTouches[i].identifier);
        }
    }

    handleMouseDown(e) {
        const idx = this.getHitTargetIdx(e);
        if (idx !== -1) {
            this.handleTap(idx);
        }
    }
    handleMouseMove(e) { }
    handleMouseUp(e) { }

    handleTap(targetIdx) {
        // Visual feedback immediately
        // Logic for checking hit
        const now = (this.video.currentTime * 1000); // Video time for sync judgment works best
        // Actually, since `update` logic uses video time for `miss` check, we should use video time for hit check too.

        // But wait, `notes` have `spawnTime` based on `performance.now()` in my `addNote` above...
        // This is a mismatch risk.
        // `update` uses `now = this.video.currentTime * 1000`.
        // `draw` uses `now = performance.now() - this.startTime`.
        // We MUST synchronize these.
        // Usually `video.currentTime` is the master clock.
        // `performance.now() - startTime` drifts if video buffers.

        // I will change `draw` and `addNote` to rely on `video.currentTime` equivalent if possible,
        // or ensure `startTime` is reset on play/seek.
        // In `startGame`, `startTime` IS set.
        // But if video stalls, `startTime` isn't adjusted.
        // Ideally we use a `getGameTime()` { return video.currentTime * 1000; }

        // For this fix, I will stick to existing patterns but be careful.
        // `update` line 420: `const now = this.video.currentTime * 1000;`
        // `draw` line 510: `const now = performance.now() - this.startTime;`
        // This IS A BUG in existing code too! They will desync.
        // However, I am here to fix the "Start" issue first.
        // Users didn't complain about desync yet (or maybe they did with "not starting").

        // I will use `performance.now() - this.startTime` for `addNote` to match `draw`.
        // And I will try to use the same for judgment.

        const gameTime = performance.now() - this.startTime;

        // Find closest note to this target
        let bestNote = null;
        let minDiff = Infinity;

        this.notes.forEach(note => {
            if (note.targetIdx === targetIdx && !note.processed) {
                // Arrival time is note.spawnTime + note.duration
                const arrival = note.spawnTime + note.duration;
                const diff = Math.abs(gameTime - arrival);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestNote = note;
                }
            }
        });

        if (bestNote && minDiff < 200) { // 200ms window
            bestNote.processed = true;
            let judgment = 'GOOD';
            if (minDiff < 50) judgment = 'PERFECT';
            else if (minDiff < 100) judgment = 'GREAT';

            this.applyJudgment(judgment);
            this.spawnHitEffect(targetIdx, judgment);
        } else {
            // Empty tap?
        }
    }



    applyJudgment(j, countStats = true) {
        this.showJudgment(j);

        let hpChange = 0;

        if (j === 'MISS') {
            this.combo = 0;
            if (countStats) this.stats.miss++;
            hpChange = -10;
        } else {
            this.playTapSound();
            this.combo++;
            this.maxCombo = Math.max(this.combo, this.maxCombo);
            let score = 500;
            if (j === 'PERFECT') {
                score = 1000;
                if (countStats) this.stats.perfect++;
                hpChange = 1; // Slight heal
            }
            else if (j === 'GREAT') {
                score = 750;
                if (countStats) this.stats.great++;
                hpChange = 0;
            }
            else {
                if (countStats) this.stats.good++;
                hpChange = -2;
            }
            this.score += score + this.combo * 10;
        }

        this.currentHP = Math.min(this.maxHP, Math.max(0, this.currentHP + hpChange));
        // if (this.currentHP <= 0) this.endGame(); // Optional: Fail condition

        this.updateHUD();
    }

    updateHUD() {
        // Update Score Gauge
        const target = (this.analysisData && this.analysisData.perfectScore) ? this.analysisData.perfectScore : this.scoreTarget;
        const scorePct = Math.min(100, (this.score / target) * 100);
        const fill = document.getElementById('score-bar-fill');
        fill.style.width = `${scorePct}%`;

        // Rainbow effect at 90% (S Rank)
        fill.classList.toggle('rainbow', scorePct >= 90);

        document.getElementById('score-val').innerText = this.score;

        document.getElementById('combo-val').innerText = this.combo;
        document.querySelector('.combo-container').classList.toggle('visible', this.combo > 0);
    }

    showJudgment(text) {
        const el = document.getElementById('judgment-text');
        el.innerText = text;
        el.style.color = `var(--${text.toLowerCase()})`;
        el.style.animation = 'none';
        el.offsetHeight;
        el.style.animation = null;
    }

    renderLoop(t) {
        try {
            this.update(t);
            this.draw();
            requestAnimationFrame(t => this.renderLoop(t));
        } catch (e) {
            this.log("Render: " + e.message);
        }
    }

    update(t) {
        if (!this.isPlaying || this.isPaused) return;
        const now = this.video.currentTime * 1000;

        if (this.currentChart && this.currentChart.length > 0) {
            // Spawn any notes that are due according to the chart
            // Look ahead by noteDuration so they arrive on time
            while (this.currentChart.length > 0 && now >= this.currentChart[0].time - this.noteDuration) {
                const beat = this.currentChart.shift();
                this.spawnNote(beat.intensity, beat.isSimul);
            }
        }

        this.notes.forEach(note => {
            if (note.processed) return;
            const arrTime = note.spawnTime + note.duration;

            if (now > arrTime + 180) {
                note.processed = true;
                this.applyJudgment('MISS');
            }
        });

        this.notes = this.notes.filter(n => !n.processed || (now - (n.spawnTime + n.duration) < 1000));

        if (this.video.ended) this.endGame();
    }

    endGame() {
        this.isPlaying = false;
        this.video.pause();
        this.video.classList.remove('visible');
        if (this.currentFile) {
            document.getElementById('res-song-title').innerText = this.currentFile.name;
        }
        document.getElementById('res-perfect').innerText = this.stats.perfect;
        document.getElementById('res-great').innerText = this.stats.great;
        document.getElementById('res-good').innerText = this.stats.good;
        document.getElementById('res-miss').innerText = this.stats.miss;
        document.getElementById('res-max-combo').innerText = this.maxCombo;
        document.getElementById('res-score').innerText = this.score;

        console.log(`[DEBUG] Final Spawned: ${this.spawnedNoteCount} (Analyzed: ${this.analysisData ? this.analysisData.totalNotes : 'N/A'})`);

        // Rank Calculation
        const target = (this.analysisData && this.analysisData.perfectScore) ? this.analysisData.perfectScore : 500000;
        const ratio = this.score / target;

        let rank = 'C';
        if (ratio >= 0.90) rank = 'S';
        else if (ratio >= 0.70) rank = 'A';
        else if (ratio >= 0.50) rank = 'B';

        const rankEl = document.getElementById('res-rank');
        rankEl.innerText = rank;

        let rankColor = '#9E9E9E';
        if (rank === 'S') rankColor = '#FFD700'; // Gold
        else if (rank === 'A') rankColor = '#E91E63'; // Pink
        else if (rank === 'B') rankColor = '#2196F3'; // Blue

        rankEl.style.color = rankColor;
        rankEl.style.textShadow = `0 0 30px ${rankColor}`;

        // Full Combo Check
        const fcEl = document.getElementById('res-full-combo');
        if (this.stats.miss === 0 && this.spawnedNoteCount > 0) {
            fcEl.style.display = 'block';
        } else {
            fcEl.style.display = 'none';
        }

        this.switchScreen('result');
    }

    draw() {
        try {
            const { ctx, canvas } = this;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const centerX = canvas.width / 2;
            const centerY = canvas.height * 0.2;

            // Targets
            this.targetPoints.forEach((pt, idx) => {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 40, 0, Math.PI * 2);
                ctx.strokeStyle = pt.color; ctx.lineWidth = 3; ctx.stroke();

                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 35, 0, Math.PI * 2);
                ctx.fillStyle = this.isTargetHeld(idx) ? pt.color + '88' : pt.color + '33';
                ctx.fill();
            });

            if (this.isPlaying) {
                const now = performance.now() - this.startTime;

                // Group simultaneous notes
                const simulGroups = {};
                this.notes.forEach(note => {
                    if (!note.processed && note.isSimultaneous) {
                        const key = note.spawnTime.toFixed(2);
                        if (!simulGroups[key]) simulGroups[key] = [];
                        simulGroups[key].push(note);
                    }
                });

                // Draw Connections (Arcs)
                Object.values(simulGroups).forEach(group => {
                    if (group.length >= 2) {
