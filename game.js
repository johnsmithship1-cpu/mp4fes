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
            if (!this.isAnalyzing) await this.analyzeAudio(this.currentFile);
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

        this.updateHUD();
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
        if (this.isAnalyzing) return;
        this.isAnalyzing = true;
        this.analysisData = null;
        const overlay = document.getElementById('analysis-overlay');
        const status = document.getElementById('analysis-status');
        overlay.style.display = 'flex';
        status.innerText = "Decoding audio...";

        try {
            const arrayBuffer = await file.arrayBuffer();
            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
            tempCtx.close();

            status.innerText = "Simulating game loop...";

            const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
                1, audioBuffer.length, audioBuffer.sampleRate
            );

            const source = offlineCtx.createBufferSource();
            source.buffer = audioBuffer;
            const analyser = offlineCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.8; // Match restoration point (default)
            const gainNode = offlineCtx.createGain();
            gainNode.gain.value = 0.5;
            source.connect(gainNode);
            gainNode.connect(analyser);
            analyser.connect(offlineCtx.destination);

            const minInterval = parseInt(document.getElementById('interval-input').value);
            const noteDuration = parseFloat(document.getElementById('speed-input').value) * 1000;

            let noteChart = [];
            this.avgEnergy = 0;
            this.lastAnalysisTime = -minInterval;
            const freqData = new Uint8Array(analyser.frequencyBinCount);

            source.start(0);

            const step = 0.0166; // 60fps sampling (matches restoration point)
            for (let t = 0; t < audioBuffer.duration; t += step) {
                offlineCtx.suspend(t).then(() => {
                    analyser.getByteFrequencyData(freqData);
                    let energy = (freqData[0] + freqData[1] + freqData[2] + freqData[3] + freqData[4]) / 5;

                    const beat = this.handleBeatDetection(t * 1000, energy, audioBuffer.duration, minInterval, noteDuration);
                    if (beat) noteChart.push(beat);

                    offlineCtx.resume();
                });
            }

            await offlineCtx.startRendering();

            // Total notes calculation (accounting for simultaneous)
            const totalNotes = noteChart.reduce((acc, b) => acc + (b.isSimul ? 2 : 1), 0);

            const baseScore = totalNotes * 1000;
            const comboBonus = 10 * (totalNotes * (totalNotes + 1) / 2);
            const perfectScore = baseScore + comboBonus;

            this.analysisData = {
                totalNotes: totalNotes,
                perfectScore: perfectScore,
                targetScore: perfectScore,
                noteChart: noteChart
            };

            status.innerText = `Ready: ${totalNotes} notes detected`;
            setTimeout(() => { if (!this.isPlaying) overlay.style.display = 'none'; }, 1000);

        } catch (e) {
            console.error("Analysis error", e);
            status.innerText = "Analysis failed.";
            setTimeout(() => { if (!this.isPlaying) overlay.style.display = 'none'; }, 2000);
        } finally {
            this.isAnalyzing = false;
        }
    }

    handleBeatDetection(now, energy, totalDuration, minInterval, noteDuration) {
        if (this.avgEnergy === 0) this.avgEnergy = energy;
        else this.avgEnergy = this.avgEnergy * 0.95 + energy * 0.05;

        const sensitivity = 1.02; // Restored to 1.02
        const isBeat = energy > this.avgEnergy * sensitivity && energy > 20; // Restored to 20
        const isTime = now - this.lastAnalysisTime > minInterval;
        const remainingTime = (totalDuration * 1000) - now;
        const canSpawn = remainingTime > (noteDuration + 500);

        if (isBeat && isTime && canSpawn) {
            const intensity = energy / this.avgEnergy;
            this.lastAnalysisTime = now;

            let simulChance = 10;
            if (intensity > 1.6) simulChance = 40;
            const isSimul = (Math.floor(now * 10) % 100) < simulChance;

            if (this.isAnalyzing) {
                return { time: now, intensity, isSimul };
            } else {
                // This branch is now legacy since we use charts, but kept as fallback
                this.spawnNote(intensity, isSimul);
                return null;
            }
        }
        return null;
    }

    togglePause() {
        if (!this.isPlaying) return;
        this.isPaused = !this.isPaused;

        const pauseScreen = document.getElementById('pause-screen');

        if (this.isPaused) {
            this.video.pause();
            if (this.audioCtx) this.audioCtx.suspend();
            pauseScreen.classList.add('active');
            // Store pause time to adjust startTime on resume?
            this.pauseStartTime = performance.now();
        } else {
            this.video.play();
            if (this.audioCtx) this.audioCtx.resume();
            pauseScreen.classList.remove('active');
            // Adjust startTime by the duration paused
            const pauseDuration = performance.now() - this.pauseStartTime;
            this.startTime += pauseDuration;
        }
    }

    spawnNote(intensity = 1.0, isSimulOverride = null) {
        if (this.isPaused) return;
        const now = this.video.currentTime * 1000;

        const getRandomTarget = (exclude = []) => {
            let idx;
            do { idx = Math.floor(Math.random() * this.numTargets); } while (exclude.includes(idx));
            return idx;
        };

        let isSimul;
        if (isSimulOverride !== null) {
            isSimul = isSimulOverride;
        } else {
            let simulChance = 10;
            if (intensity > 1.6) simulChance = 40;
            isSimul = (Math.floor(now * 10) % 100) < simulChance;
        }

        if (isSimul) {
            const t1 = getRandomTarget();
            const t2 = getRandomTarget([t1]);
            this.addNote(t1, now, this.noteDuration, 'normal', 0, true);
            this.addNote(t2, now, this.noteDuration, 'normal', 0, true);
            this.spawnedNoteCount += 2;
        } else {
            const t = getRandomTarget();
            this.addNote(t, now, this.noteDuration, 'normal');
            this.spawnedNoteCount++;
        }
    }

    addNote(targetIdx, spawnTime, duration, type, holdDuration = 0, isSimultaneous = false) {
        this.notes.push({
            targetIdx, spawnTime, duration, type, holdDuration,
            isSimultaneous,
            isHolding: false,
            processed: false
        });
    }

    // Input Handling
    getHitTargetIdx(cx, cy) {
        const rect = this.canvas.getBoundingClientRect();
        const x = cx - rect.left;
        const y = cy - rect.top;
        let closest = -1;
        let minDist = 70;
        this.targetPoints.forEach((pt, i) => {
            const d = Math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2);
            if (d < minDist) { minDist = d; closest = i; }
        });
        return closest;
    }

    handleTouchStart(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const idx = this.getHitTargetIdx(t.clientX, t.clientY);
            if (idx !== -1) {
                this.activeTouches.set(t.identifier, idx);
                this.checkHit(idx);
            }
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const idx = this.getHitTargetIdx(t.clientX, t.clientY);
            const prev = this.activeTouches.get(t.identifier);
            if (idx !== -1 && idx !== prev) {
                this.activeTouches.set(t.identifier, idx);
            } else if (idx === -1) {
                this.activeTouches.delete(t.identifier);
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            this.activeTouches.delete(e.changedTouches[i].identifier);
        }
    }

    handleMouseDown(e) {
        const idx = this.getHitTargetIdx(e.clientX, e.clientY);
        if (idx !== -1) {
            this.activeTouches.set('mouse', idx);
            this.checkHit(idx);
        }
    }
    handleMouseMove(e) {
        const idx = this.getHitTargetIdx(e.clientX, e.clientY);
        if (idx !== -1 && this.activeTouches.has('mouse')) {
            this.activeTouches.set('mouse', idx);
        } else if (idx === -1) {
            this.activeTouches.delete('mouse');
        }
    }
    handleMouseUp(e) {
        this.activeTouches.delete('mouse');
    }

    isTargetHeld(idx) {
        for (let val of this.activeTouches.values()) {
            if (val === idx) return true;
        }
        return false;
    }

    checkHit(targetIdx) {
        if (!this.isPlaying) return;
        const now = performance.now() - this.startTime;

        let found = null;
        let minDiff = Infinity;

        for (let note of this.notes) {
            if (note.targetIdx === targetIdx && !note.processed) {
                const arrTime = note.spawnTime + note.duration;
                const diff = Math.abs(now - arrTime);
                if (diff < 180 && diff < minDiff) {
                    minDiff = diff; found = note;
                }
            }
        }

        if (found) {
            let j = 'MISS';
            if (minDiff < 60) j = 'PERFECT';
            else if (minDiff < 120) j = 'GREAT';
            else j = 'GOOD';

            found.processed = true;
            this.spawnHitEffect(targetIdx, j);
            this.applyJudgment(j);
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

        // Rainbow effect at 80% (S Rank)
        fill.classList.toggle('rainbow', scorePct >= 80);

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
            while (this.currentChart.length > 0 && now >= this.currentChart[0].time) {
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
        if (ratio >= 0.90) rank = 'SS';
        else if (ratio >= 0.80) rank = 'S';
        else if (ratio >= 0.70) rank = 'A';
        else if (ratio >= 0.60) rank = 'B';

        const rankEl = document.getElementById('res-rank');
        rankEl.innerText = rank;

        let rankColor = '#9E9E9E';
        if (rank === 'SS') rankColor = '#00f2ff'; // Cyan-Glow
        else if (rank === 'S') rankColor = '#FFD700'; // Gold
        else if (rank === 'A') rankColor = '#E91E63'; // Pink
        else if (rank === 'B') rankColor = '#2196F3'; // Blue

        rankEl.style.color = rankColor;
        rankEl.style.textShadow = `0 0 30px ${rankColor}`;

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
                        const n1 = group[0];
                        const n2 = group[1];
                        const pos1 = this.getNotePos(n1, now, centerX, centerY);
                        const pos2 = this.getNotePos(n2, now, centerX, centerY);

                        const r = Math.sqrt((pos1.x - centerX) ** 2 + (pos1.y - centerY) ** 2);
                        const ang1 = Math.atan2(pos1.y - centerY, pos1.x - centerX);
                        const ang2 = Math.atan2(pos2.y - centerY, pos2.x - centerX);

                        const startAng = Math.min(ang1, ang2);
                        const endAng = Math.max(ang1, ang2);

                        ctx.save();
                        // Gradient stroke
                        const grad = ctx.createLinearGradient(pos1.x, pos1.y, pos2.x, pos2.y);
                        grad.addColorStop(0, pos1.color);
                        grad.addColorStop(1, pos2.color);

                        ctx.beginPath();
                        ctx.arc(centerX, centerY, r, startAng, endAng);
                        ctx.lineWidth = 8;
                        ctx.strokeStyle = grad;
                        ctx.globalAlpha = 0.6;
                        ctx.shadowBlur = 10;
                        ctx.shadowColor = 'white';
                        ctx.stroke();
                        ctx.restore();
                    }
                });

                // Draw Notes
                this.notes.forEach(note => {
                    if (note.processed) return;
                    this.drawHead(note, now, centerX, centerY);
                });

                this.drawEffects();
                this.drawParticles();
            }
        } catch (e) {
            console.error("Draw error", e);
            throw e;
        }
    }

    getNotePos(note, now, cx, cy) {
        const elapsed = now - note.spawnTime;
        const prog = elapsed / note.duration;
        const target = this.targetPoints[note.targetIdx];
        const x = cx + (target.x - cx) * prog;
        const y = cy + (target.y - cy) * prog;
        return { x, y, progress: prog, color: target.color };
    }

    drawHead(note, now, cx, cy) {
        let pos;
        const target = this.targetPoints[note.targetIdx];
        pos = this.getNotePos(note, now, cx, cy);

        const elapsed = now - note.spawnTime;
        const prog = elapsed / note.duration;
        if (prog > 1.2) return;

        // Enhanced Glow (Screen Blend + High Blur)
        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';

        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 30, 0, Math.PI * 2);

        this.ctx.lineWidth = 8;
        this.ctx.strokeStyle = pos.color;

        this.ctx.shadowBlur = 50;
        this.ctx.shadowColor = pos.color;

        this.ctx.stroke();
        this.ctx.restore();

        if (note.isSimultaneous) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.beginPath();
            this.ctx.moveTo(pos.x - 20, pos.y);
            this.ctx.lineTo(pos.x + 20, pos.y);
            this.ctx.lineWidth = 8;
            this.ctx.strokeStyle = pos.color;
            this.ctx.shadowBlur = 50;
            this.ctx.shadowColor = pos.color;
            this.ctx.stroke();
            this.ctx.restore();
        }


    }

    spawnHitEffect(targetIdx, judgment) {
        if (targetIdx < 0 || targetIdx >= this.targetPoints.length) return;
        const target = this.targetPoints[targetIdx];
        this.effects.push({
            x: target.x,
            y: target.y,
            color: target.color,
            startTime: performance.now() - this.startTime,
            judgment: judgment
        });
        this.spawnParticles(targetIdx, judgment);
    }

    spawnParticles(targetIdx, judgment) {
        if (targetIdx < 0 || targetIdx >= this.targetPoints.length) return;
        const target = this.targetPoints[targetIdx];

        let count = 0;
        let speed = 2; // base speed

        if (judgment === 'PERFECT') { count = 20; speed = 6; }
        else if (judgment === 'GREAT') { count = 12; speed = 4; }
        else if (judgment === 'GOOD') { count = 5; speed = 2; }

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spd = Math.random() * speed + 2;
            this.particles.push({
                x: target.x,
                y: target.y,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                color: target.color,
                life: 1.0,
                decay: 0.02 + Math.random() * 0.03,
                size: Math.random() * 4 + 2
            });
        }
    }

    drawParticles() {
        if (this.particles.length === 0) return;

        this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen'; // Make them glow/add

        // Update and filter
        for (let i = this.particles.length - 1; i >= 0; i--) {
            let p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= p.decay;

            if (p.life <= 0) {
                this.particles.splice(i, 1);
                continue;
            }

            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            this.ctx.fillStyle = p.color;
            this.ctx.globalAlpha = p.life;
            this.ctx.fill();
        }

        this.ctx.restore();
    }

    drawEffects() {
        const now = performance.now() - this.startTime;
        // Filter out old effects (500ms duration)
        this.effects = this.effects.filter(fx => (now - fx.startTime) < 500);

        this.ctx.save();
        this.effects.forEach(fx => {
            const progress = (now - fx.startTime) / 500;
            // Easing: fast out, slow in
            const ease = 1 - Math.pow(1 - progress, 3);
            const alpha = 1 - progress;

            // Expanding ring
            this.ctx.beginPath();
            this.ctx.arc(fx.x, fx.y, 40 + ease * 40, 0, Math.PI * 2);
            this.ctx.strokeStyle = fx.color;
            this.ctx.lineWidth = 10 * alpha;
            this.ctx.globalAlpha = alpha;
            this.ctx.stroke();

            // Inner flash
            if (progress < 0.3) {
                this.ctx.beginPath();
                this.ctx.arc(fx.x, fx.y, 40, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(255, 255, 255, ${0.5 * (1 - progress / 0.3)})`;
                this.ctx.fill();
            }
        });
        this.ctx.restore();
    }
}
window.onload = () => { window.game = new GameEngine(); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
