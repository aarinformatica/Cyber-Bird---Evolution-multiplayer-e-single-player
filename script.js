document.addEventListener('DOMContentLoaded', () => {
    // CHAVE DO ABLY (Substitua por sua nova chave privada gerada no painel)
    const ABLY_KEY = 'zfqwdA.QY0KxQ:_RQcTI6NCeRMNnLLyC8Ebb6Lg50xnDlcwvRv4wQ3H5o';

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('game-container');

    // Elementos da Interface DOM
    const overlay = document.getElementById('overlay');
    const singleBtn = document.getElementById('single-btn');
    const multiBtn = document.getElementById('multi-btn');
    const connectionStatus = document.getElementById('connection-status');
    const gameTitle = document.getElementById('game-title');
    const currentScoreDOM = document.getElementById('current-score');
    const p2ScoreBox = document.getElementById('p2-score-box');
    const p2ScoreDOM = document.getElementById('p2-score');
    const bestBox = document.getElementById('best-box');
    const bestScoreDOM = document.getElementById('best-score');
    const currentLevelDOM = document.getElementById('current-level');
    const shieldStatusDOM = document.getElementById('shield-status');
    const flashEffect = document.getElementById('flash-effect');
    const levelAlert = document.getElementById('level-alert');
    const laserChargeBar = document.getElementById('laser-charge-bar');
    const laserReadyText = document.getElementById('laser-ready-text');

    // Variáveis de Controle de FPS / Delta Time
    let lastTime = performance.now();
    let gameEngine;

    // Estado do Jogo
    let score = 0;
    let level = 1;
    let hasShield = false;
    let bestScore = localStorage.getItem('cyberbird-best') || 0;
    if (bestScoreDOM) bestScoreDOM.textContent = bestScore;
    
    let gameActive = false;
    let laserCharge = 0;         
    let laserActiveTimer = 0;    

    // --- VARIÁVEIS MULTIPLAYER (ABLY) ---
    let isMultiplayer = false;
    let ablyClient = null;
    let gameChannel = null;
    let myId = null;
    let isHost = false; 
    let opponentActive = false;
    let opponentDead = false;
    let opponentScore = 0;

    const opponentBird = {
        x: 80,
        y: 300,
        radius: 10,
        targetY: 300,
        velocity: 0,
        laserActive: 0
    };

    // Ajuste adaptativo do canvas
    function resizeCanvas() {
        if (!container || !canvas) return;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
        background.init();
    });

    // Web Audio API sintética
    let audioCtx = null;
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playSound(freq, type, duration, endFreq = null) {
        if (!audioCtx) return;
        try {
            let osc = audioCtx.createOscillator();
            let gainNode = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
            if (endFreq) {
                osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);
            }
            gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + duration);
        } catch(e) {}
    }

    // Atributos do Jogador Principal
    const bird = {
        x: 80,
        y: 300,
        radius: 10,
        velocity: 0,
        gravity: 22.8, 
        jump: -432,   
        trail: []
    };

    let pipes = [];
    let particles = [];
    let items = [];

    const pipeConfig = {
        width: 60,
        baseGap: 180,       
        currentGap: 180,    
        minGap: 125,        
        baseSpeed: 180, 
        currentSpeed: 180,
        spawnRate: 1.6, 
        timer: 0,
        verticalSpeed: 0    
    };

    // ==========================================
    // PARALLAX FONDO PROCEDURAL
    // ==========================================
    const background = {
        stars: [], buildingsFar: [], buildingsNear: [], groundOffset: 0,
        init() {
            if (!canvas) return;
            this.stars = Array.from({ length: 40 }, () => ({
                x: Math.random() * canvas.width, y: Math.random() * (canvas.height - 200),
                size: Math.random() * 2, alpha: Math.random()
            }));
            this.buildingsFar = Array.from({ length: 8 }, (_, i) => ({
                x: i * 60, width: 50 + Math.random() * 30, height: 150 + Math.random() * 100, color: '#13132b'
            }));
            this.buildingsNear = Array.from({ length: 6 }, (_, i) => ({
                x: i * 90, width: 60 + Math.random() * 40, height: 220 + Math.random() * 120, color: '#1c1c3a',
                windows: Array.from({ length: 15 }, () => ({
                    wx: Math.random(), wy: Math.random(), wColor: Math.random() > 0.5 ? '#00f2fe' : '#ff007f'
                }))
            }));
        },
        updateAndDraw(dt) {
            if (!canvas || !ctx) return;
            let skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
            skyGrad.addColorStop(0, '#04040c'); skyGrad.addColorStop(0.7, '#0f0f26'); skyGrad.addColorStop(1, '#1b112c');
            ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, canvas.width, canvas.height);

            this.stars.forEach(s => {
                s.alpha += (Math.random() - 0.5) * 0.05;
                s.alpha = Math.max(0.2, Math.min(1, s.alpha));
                ctx.fillStyle = `rgba(0, 242, 254, ${s.alpha})`;
                ctx.fillRect(s.x, s.y, s.size, s.size);
            });
            this.buildingsFar.forEach(b => {
                if (gameActive) b.x -= (pipeConfig.currentSpeed * 0.1 * dt);
                if (b.x + b.width < 0) b.x = canvas.width;
                ctx.fillStyle = b.color; ctx.fillRect(b.x, canvas.height - b.height, b.width, b.height);
            });
            this.buildingsNear.forEach(b => {
                if (gameActive) b.x -= (pipeConfig.currentSpeed * 0.25 * dt);
                if (b.x + b.width < 0) b.x = canvas.width;
                ctx.fillStyle = b.color; ctx.fillRect(b.x, canvas.height - b.height, b.width, b.height);
                b.windows.forEach(w => {
                    let winX = b.x + (w.wx * (b.width - 10)) + 5;
                    let winY = (canvas.height - b.height) + (w.wy * (b.height - 40)) + 10;
                    if (winX > b.x && winX < b.x + b.width - 5) {
                        ctx.fillStyle = Math.random() > 0.99 ? '#05050f' : w.wColor;
                        ctx.fillRect(winX, winY, 3, 5);
                    }
                });
            });

            if (gameActive) this.groundOffset = (this.groundOffset - pipeConfig.currentSpeed * dt) % 20;
            ctx.strokeStyle = 'rgba(255, 0, 127, 0.4)'; ctx.lineWidth = 2;
            let groundY = canvas.height - 30;
            ctx.fillStyle = '#0a0518'; ctx.fillRect(0, groundY, canvas.width, 30);
            ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(canvas.width, groundY); ctx.stroke();
            for (let x = this.groundOffset; x < canvas.width; x += 20) {
                ctx.beginPath(); ctx.moveTo(x, groundY); ctx.lineTo(x - 10, canvas.height); ctx.stroke();
            }
        }
    };
    background.init();

    // ==========================================
    // CAPTURA DE INPUTS
    // ==========================================
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') eventJump();
        if (e.code === 'KeyX') eventFireLaser();
    });
    if (canvas) {
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) eventJump();
            if (e.button === 2) { e.preventDefault(); eventFireLaser(); }
        });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        canvas.addEventListener('touchstart', (e) => { 
            e.preventDefault();
            if(e.touches[0].clientX < window.innerWidth / 2) eventJump(); else eventFireLaser();
        }, { passive: false });
    }

    // Ouvintes dos Botões de Modo de Jogo
    if (singleBtn) {
        singleBtn.addEventListener('click', () => {
            initAudio();
            isMultiplayer = false;
            if (p2ScoreBox) p2ScoreBox.style.display = 'none';
            if (bestBox) bestBox.style.display = 'block';
            resetGame();
        });
    }

    if (multiBtn) {
        multiBtn.addEventListener('click', () => {
            initAudio();
            if (!ablyClient) {
                connectAbly();
            }
        });
    }

    // ==========================================
    // ENGINE MULTIPLAYER - CONEXÃO ABLY
    // ==========================================
    function connectAbly() {
        if (ABLY_KEY === 'COLOQUE_SUA_NOVA_CHAVE_AQUI') {
            alert('Por favor, configure sua chave do Ably válida no script.js!');
            return;
        }

        if (connectionStatus) connectionStatus.textContent = "Conectando ao Cyber-Net...";
        if (multiBtn) multiBtn.disabled = true;

        ablyClient = new Ably.Realtime({ key: ABLY_KEY });
        
        ablyClient.connection.on('connected', () => {
            myId = ablyClient.auth.clientId || Math.random().toString(36).substring(2, 9);
            // Entra em uma sala única global padrão para teste prático rápido
            gameChannel = ablyClient.channels.get('cyber-room-default');
            
            if (connectionStatus) connectionStatus.textContent = "Buscando oponente...";

            // Gerenciamento de Presença (Lobby)
            gameChannel.presence.subscribe('enter', updateLobby);
            gameChannel.presence.subscribe('leave', (member) => {
                if (member.clientId !== myId) {
                    if (connectionStatus) connectionStatus.textContent = "Oponente desconectou.";
                    opponentActive = false;
                    if(gameActive) gameOver();
                }
            });

            gameChannel.presence.enter({ id: myId });

            // Mensagens de Eventos de Jogo em Tempo Real
            gameChannel.subscribe('pos', (msg) => {
                if (msg.data.id !== myId) {
                    opponentActive = true;
                    opponentBird.targetY = msg.data.y;
                    opponentBird.velocity = msg.data.v;
                }
            });

            gameChannel.subscribe('laser', (msg) => {
                if (msg.data.id !== myId) opponentBird.laserActive = 15;
            });

            gameChannel.subscribe('score', (msg) => {
                if (msg.data.id !== myId) {
                    opponentScore = msg.data.s;
                    if(p2ScoreDOM) p2ScoreDOM.textContent = opponentScore;
                }
            });

            gameChannel.subscribe('dead', (msg) => {
                if (msg.data.id !== myId) opponentDead = true;
            });

            // Canal de sincronia de obstáculos comandados pelo Host
            gameChannel.subscribe('spawn-pipe', (msg) => {
                if (!isHost && gameActive) {
                    pipes.push({
                        x: msg.data.x,
                        top: msg.data.top,
                        bottom: msg.data.bottom,
                        passed: false,
                        direction: msg.data.direction
                    });
                }
            });

            gameChannel.subscribe('spawn-item', (msg) => {
                if (!isHost && gameActive) {
                    items.push({ x: msg.data.x, y: msg.data.y, radius: 9, pulse: 0 });
                }
            });

            gameChannel.subscribe('start-sync', () => {
                if (!gameActive) startMultiplayerGame();
            });
        });

        ablyClient.connection.on('failed', () => {
            if (connectionStatus) connectionStatus.textContent = "Falha na conexão.";
            if (multiBtn) multiBtn.disabled = false;
        });
    }

    function updateLobby() {
        if (!gameChannel) return;
        gameChannel.presence.get((err, members) => {
            if (err) return;
            if (members.length >= 2) {
                if (connectionStatus) connectionStatus.textContent = "Oponente Pronto! Iniciando...";
                
                // Determina quem é o Host (O primeiro da lista retornado pelo Ably)
                members.sort((a, b) => a.timestamp - b.timestamp);
                isHost = (members[0].id === myId || members[0].clientId === myId);

                setTimeout(() => {
                    if (gameChannel) gameChannel.publish('start-sync', {});
                }, 1000);
            } else {
                if (connectionStatus) connectionStatus.textContent = "Aguardando Player 2...";
                isHost = true;
            }
        });
    }

    function startMultiplayerGame() {
        isMultiplayer = true;
        if (p2ScoreBox) p2ScoreBox.style.display = 'block';
        if (bestBox) bestBox.style.display = 'none'; // Esconde recorde local no versus
        opponentDead = false;
        opponentScore = 0;
        if(p2ScoreDOM) p2ScoreDOM.textContent = "0";
        resetGame();
    }

    // Emissores de Redes síncronos
    function networkSendPos() {
        if (!isMultiplayer || !gameChannel) return;
        gameChannel.publish('pos', { id: myId, y: bird.y, v: bird.velocity });
    }

    // Declaração de networkSendScore para corrigir dependências internas do loop
    function networkSendScore() {
        if (!isMultiplayer || !gameChannel) return;
        gameChannel.publish('score', { id: myId, s: score });
    }

    function eventJump() {
        if (!gameActive) return;
        bird.velocity = bird.jump;
        playSound(400, 'square', 0.1, 700);
        for(let i=0; i<6; i++) particles.push(new Particle(bird.x - 5, bird.y, '#ff007f'));
        networkSendPos();
    }

    function eventFireLaser() {
        if (!gameActive || laserCharge < 100) return;
        
        laserCharge = 0;
        laserActiveTimer = 15;
        if(laserReadyText) laserReadyText.classList.remove('ready-pulse');
        playSound(900, 'sawtooth', 0.4, 80);

        if (isMultiplayer && gameChannel) gameChannel.publish('laser', { id: myId });

        if (flashEffect) {
            flashEffect.classList.remove('flash-active');
            void flashEffect.offsetWidth;
            flashEffect.classList.add('flash-active');
        }
        if (container) {
            container.classList.add('shake');
            setTimeout(() => container.classList.remove('shake'), 200);
        }

        displayAlert("LASER FIRED!", false);

        for (let i = pipes.length - 1; i >= 0; i--) {
            if (pipes[i].x + pipeConfig.width > bird.x) {
                for (let p = 0; p < 30; p++) {
                    particles.push(new Particle(pipes[i].x + pipeConfig.width / 2, bird.y + (Math.random() - 0.5) * 80, '#00f2fe'));
                }
                pipes.splice(i, 1);
            }
        }
    }

    class Particle {
        constructor(x, y, color) {
            this.x = x; this.y = y; this.color = color; this.alpha = 1;
            this.size = Math.random() * 3 + 1.5;
            this.speedX = Math.random() * -180 - 60;
            this.speedY = (Math.random() - 0.5) * 180;
        }
        update(dt) { this.x += this.speedX * dt; this.y += this.speedY * dt; this.alpha -= 1.5 * dt; }
        draw() {
            if (!ctx) return;
            ctx.save(); ctx.globalAlpha = Math.max(0, this.alpha);
            ctx.fillStyle = this.color; ctx.shadowBlur = 8; ctx.shadowColor = this.color;
            ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
    }

    function displayAlert(text, isShield = false) {
        if (levelAlert) {
            levelAlert.innerHTML = text;
            levelAlert.style.textShadow = isShield ? "0 0 15px #ffe600, 0 0 30px #ffe600" : "0 0 15px #00f2fe, 0 0 30px #ff007f";
            levelAlert.classList.remove('level-active');
            void levelAlert.offsetWidth;
            levelAlert.classList.add('level-active');
        }
    }

    function triggerLevelUp() {
        level++;
        if (currentLevelDOM) currentLevelDOM.textContent = level;
        pipeConfig.currentSpeed = 180 + (level - 1) * 24;
        pipeConfig.spawnRate = Math.max(1.0, 1.6 - (level - 1) * 0.1);
        pipeConfig.currentGap = Math.max(pipeConfig.minGap, pipeConfig.baseGap - (level - 1) * 10);
        pipeConfig.verticalSpeed = (level - 1) * 48;

        setTimeout(() => playSound(523.25, 'triangle', 0.15), 0);
        setTimeout(() => playSound(783.99, 'triangle', 0.3), 200);

        if (flashEffect) {
            flashEffect.classList.remove('flash-active');
            void flashEffect.offsetWidth;
            flashEffect.classList.add('flash-active');
        }
        displayAlert(`LEVEL ${level}<br><span style="font-size:1.1rem;color:#ff007f;">ACELERANDO REDE!</span>`);
    }

    function setShield(state) {
        hasShield = state;
        if (shieldStatusDOM) {
            shieldStatusDOM.textContent = state ? "ON" : "OFF";
            if (state) shieldStatusDOM.classList.add('shield-on-text'); else shieldStatusDOM.classList.remove('shield-on-text');
        }
    }

    function resetGame() {
        score = 0; level = 1; laserCharge = 0; laserActiveTimer = 0;
        pipeConfig.currentSpeed = pipeConfig.baseSpeed;
        pipeConfig.currentGap = pipeConfig.baseGap; 
        pipeConfig.spawnRate = 1.6; pipeConfig.timer = 0; pipeConfig.verticalSpeed = 0; 
        setShield(false);

        if (currentScoreDOM) currentScoreDOM.textContent = score;
        if (currentLevelDOM) currentLevelDOM.textContent = level;
        if (laserChargeBar) laserChargeBar.style.width = '0%';
        
        if (canvas) bird.y = canvas.height / 2;
        bird.velocity = 0; bird.trail = [];
        pipes = []; particles = []; items = [];
        gameActive = true;
        if (overlay) overlay.classList.remove('active');
        
        lastTime = performance.now();
        cancelAnimationFrame(gameEngine);
        gameEngine = requestAnimationFrame(update);
    }

    function gameOver() {
        if (!gameActive) return;
        gameActive = false;
        playSound(150, 'sawtooth', 0.5, 40);
        
        if (isMultiplayer && gameChannel) {
            gameChannel.publish('dead', { id: myId });
        }

        // Fluxo de validação de fim de partida versus ou solo
        if (isMultiplayer) {
            if (opponentDead || !opponentActive) {
                evaluateMultiplayerMatch();
            } else {
                if (gameTitle) gameTitle.innerHTML = "VOCÊ CAIU";
                const ins = document.getElementById('game-instruction');
                if (ins) ins.innerHTML = `AGUARDANDO PLAYER 2 CONCLUIR...<br>Seu Score: <span class="highlight">${score}</span>`;
                if (overlay) overlay.classList.add('active');
                if (multiBtn) multiBtn.disabled = false;
            }
        } else {
            if (score > bestScore) {
                bestScore = score;
                localStorage.setItem('cyberbird-best', bestScore);
                if (bestScoreDOM) bestScoreDOM.textContent = bestScore;
            }
            if (gameTitle) gameTitle.innerHTML = "GAME<span>OVER</span>";
            const ins = document.getElementById('game-instruction');
            if (ins) ins.innerHTML = `SINAL PERDIDO NO LEVEL ${level}<br><br>Pontos: <span class="highlight">${score}</span>`;
            if (overlay) overlay.classList.add('active');
            if (multiBtn) multiBtn.disabled = false;
        }
    }

    function evaluateMultiplayerMatch() {
        if (gameTitle) {
            if (score > opponentScore) {
                gameTitle.innerHTML = "VITÓRIA<span>✓</span>";
            } else if (score < opponentScore) {
                gameTitle.innerHTML = "DERROTA<span>✗</span>";
            } else {
                gameTitle.innerHTML = "EMPATE<span>=</span>";
            }
        }
        const ins = document.getElementById('game-instruction');
        if (ins) ins.innerHTML = `Seu placar: ${score} vs Oponente: ${opponentScore}`;
        if (overlay) overlay.classList.add('active');
        if (multiBtn) multiBtn.disabled = false;
        if (connectionStatus) connectionStatus.textContent = "";
    }

    // ==========================================
    // LOOP PRINCIPAL DE RENDERIZAÇÃO (DELTA TIME)
    // ==========================================
    function update(timestamp) {
        let dt = (timestamp - lastTime) / 1000;
        if (dt > 0.1) dt = 0.1;
        lastTime = timestamp;

        if (!canvas || !ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        background.updateAndDraw(dt);

        // Renderiza o fantasma do oponente se o modo online estiver ativo
        if (isMultiplayer && opponentActive && !opponentDead) {
            // Interpolação linear suave (Lerp) para remover o lag de pacotes de rede
            opponentBird.y += (opponentBird.targetY - opponentBird.y) * 15 * dt;

            // Render do Laser Remoto do Oponente
            if (opponentBird.laserActive > 0) {
                opponentBird.laserActive--;
                ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = '#00f2fe';
                ctx.strokeStyle = '#fff'; ctx.lineWidth = opponentBird.laserActive > 5 ? 8 : opponentBird.laserActive;
                ctx.beginPath(); ctx.moveTo(opponentBird.x + 10, opponentBird.y); ctx.lineTo(canvas.width, opponentBird.y);
                ctx.stroke(); ctx.restore();
            }

            // Corpo do Pássaro Oponente
            ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#00f2fe'; ctx.fillStyle = 'rgba(0, 242, 254, 0.7)';
            ctx.translate(opponentBird.x, opponentBird.y);
            ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath();
            ctx.fill(); ctx.restore();
        }

        // Se o seu pássaro morreu mas você está assistindo o oponente terminar no online
        if (!gameActive && isMultiplayer && !opponentDead && opponentActive) {
            if (pipeConfig.timer === 0) networkSendScore(); // Força sync regular mínimo
            // Mantém os canos movendo na tela de quem morreu para ver o jogo acabar de forma fluida
            for (let i = pipes.length - 1; i >= 0; i--) pipes[i].x -= pipeConfig.currentSpeed * dt;
            gameEngine = requestAnimationFrame(update);
            return;
        } else if (!gameActive) {
            // Se ambos morreram, encerra e avalia
            if(isMultiplayer && opponentDead) evaluateMultiplayerMatch();
            gameEngine = requestAnimationFrame(update);
            return;
        }

        // Loop de Carregamento Local do Laser
        if (laserCharge < 100) {
            laserCharge += 15 * dt; 
            if (laserCharge >= 100) {
                laserCharge = 100;
                if (laserReadyText) laserReadyText.classList.add('ready-pulse');
                playSound(500, 'sine', 0.15, 800); 
            }
            if (laserChargeBar) laserChargeBar.style.width = `${laserCharge}%`;
        }

        // Rastro de Partículas Local do Jogador
        bird.trail.push({ x: bird.x, y: bird.y });
        if (bird.trail.length > 12) bird.trail.shift();
        for (let i = 0; i < bird.trail.length; i++) {
            let ratio = i / bird.trail.length;
            ctx.beginPath(); ctx.arc(bird.trail[i].x, bird.trail[i].y, bird.radius * ratio, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 0, 127, ${ratio * 0.35})`; ctx.fill();
        }

        bird.velocity += bird.gravity * 60 * dt;
        bird.y += bird.velocity * dt;

        // Desenha o Escudo
        if (hasShield) {
            ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = '#ffe600';
            ctx.strokeStyle = `rgba(255, 230, 0, ${0.4 + Math.sin(Date.now() * 0.01) * 0.2})`; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(bird.x, bird.y, bird.radius + 12, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }

        // Desenha o Laser Local Ativo
        if (laserActiveTimer > 0) {
            laserActiveTimer--;
            ctx.save(); ctx.shadowBlur = 20; ctx.shadowColor = '#ff007f'; ctx.strokeStyle = '#fff';
            ctx.lineWidth = laserActiveTimer > 5 ? 12 : laserActiveTimer * 2;
            ctx.beginPath(); ctx.moveTo(bird.x + 15, bird.y); ctx.lineTo(canvas.width, bird.y); ctx.stroke();
            ctx.strokeStyle = '#ff007f'; ctx.lineWidth = laserActiveTimer > 5 ? 4 : 1; ctx.stroke(); ctx.restore();
        }

        // Desenha Nave do Player 1
        ctx.save(); ctx.shadowBlur = 15; ctx.shadowColor = '#ff007f'; ctx.fillStyle = '#ff007f';
        ctx.translate(bird.x, bird.y);
        ctx.rotate(Math.min(Math.max(bird.velocity * 0.002, -0.4), 0.7));
        ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9); ctx.closePath();
        ctx.fill(); ctx.restore();

        // Limites de colisão globais
        if (bird.y + bird.radius >= canvas.height - 30 || bird.y - bird.radius <= 0) {
            gameOver(); return;
        }

        // Sincronia de Instanciamento de Mapas (Host vs Client)
        pipeConfig.timer += dt;
        if (pipeConfig.timer >= pipeConfig.spawnRate) {
            pipeConfig.timer = 0;

            if (!isMultiplayer || (isMultiplayer && isHost)) {
                const minHeight = 60;
                const maxHeight = (canvas.height - 30) - pipeConfig.currentGap - minHeight;
                const topHeight = Math.floor(Math.random() * (maxHeight - minHeight + 1)) + minHeight;
                const dir = Math.random() > 0.5 ? 1 : -1;

                const newPipe = { x: canvas.width, top: topHeight, bottom: (canvas.height - 30) - topHeight - pipeConfig.currentGap, passed: false, direction: dir };
                pipes.push(newPipe);

                if (isMultiplayer && isHost && gameChannel) {
                    gameChannel.publish('spawn-pipe', { x: canvas.width, top: newPipe.top, bottom: newPipe.bottom, direction: dir });
                }

                if (Math.random() < 0.25) {
                    const itemY = topHeight + pipeConfig.currentGap / 2 + (Math.random() - 0.5) * 40;
                    items.push({ x: canvas.width + pipeConfig.width / 2, y: itemY, radius: 9, pulse: 0 });
                    if (isMultiplayer && isHost && gameChannel) {
                        gameChannel.publish('spawn-item', { x: canvas.width + pipeConfig.width / 2, y: itemY });
                    }
                }
            }
        }

        // Loop de Itens / Escudos
        for (let i = items.length - 1; i >= 0; i--) {
            items[i].x -= pipeConfig.currentSpeed * dt;
            items[i].pulse += 4.2 * dt;

            ctx.save();
            let glow = 8 + Math.sin(items[i].pulse) * 5;
            ctx.shadowBlur = glow; ctx.shadowColor = '#ffe600'; ctx.fillStyle = '#ffe600';
            ctx.beginPath(); ctx.arc(items[i].x, items[i].y, items[i].radius, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(items[i].x, items[i].y, items[i].radius * 0.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();

            if (Math.hypot(bird.x - items[i].x, bird.y - items[i].y) < bird.radius + items[i].radius) {
                playSound(600, 'sine', 0.2, 1000);
                setShield(true); displayAlert("SHIELD ACTIVATED", true);
                for (let p = 0; p < 15; p++) particles.push(new Particle(items[i].x, items[i].y, '#ffe600'));
                items.splice(i, 1); continue;
            }
            if (items[i].x + 20 < 0) items.splice(i, 1);
        }

        // Loop de Colisão de Canos
        for (let i = pipes.length - 1; i >= 0; i--) {
            pipes[i].x -= pipeConfig.currentSpeed * dt;

            if (pipeConfig.verticalSpeed > 0) {
                pipes[i].top += pipeConfig.verticalSpeed * pipes[i].direction * dt;
                pipes[i].bottom -= pipeConfig.verticalSpeed * pipes[i].direction * dt;
                if (pipes[i].top < 40 || (canvas.height - 30) - pipes[i].bottom > canvas.height - 70) {
                    pipes[i].direction *= -1; 
                }
            }

            ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = '#00f2fe'; ctx.fillStyle = 'rgba(0, 242, 254, 0.15)'; ctx.strokeStyle = '#00f2fe'; ctx.lineWidth = 3;
            ctx.fillRect(pipes[i].x, 0, pipeConfig.width, pipes[i].top);
            ctx.strokeRect(pipes[i].x, -5, pipeConfig.width, pipes[i].top + 5);
            ctx.fillRect(pipes[i].x, (canvas.height - 30) - pipes[i].bottom, pipeConfig.width, pipes[i].bottom);
            ctx.strokeRect(pipes[i].x, (canvas.height - 30) - pipes[i].bottom, pipeConfig.width, pipes[i].bottom + 5);
            ctx.restore();

            if (bird.x + bird.radius > pipes[i].x && bird.x - bird.radius < pipes[i].x + pipeConfig.width) {
                if (bird.y - bird.radius < pipes[i].top || bird.y + bird.radius > (canvas.height - 30) - pipes[i].bottom) {
                    if (hasShield) {
                        playSound(300, 'sawtooth', 0.3, 100); setShield(false); displayAlert("SHIELD BROKEN", true);
                        if (flashEffect) { flashEffect.classList.add('flash-active'); setTimeout(() => flashEffect.classList.remove('flash-active'), 400); }
                        for (let p = 0; p < 25; p++) particles.push(new Particle(pipes[i].x + pipeConfig.width/2, bird.y, '#ffe600'));
                        pipes.splice(i, 1); continue;
                    } else {
                        gameOver(); return;
                    }
                }
            }

            if (!pipes[i].passed && pipes[i].x + pipeConfig.width < bird.x) {
                pipes[i].passed = true;
                score++;
                if (currentScoreDOM) currentScoreDOM.textContent = score;
                playSound(880, 'sine', 0.08);
                networkSendScore();
                
                if (score % 100 === 0) triggerLevelUp();
            }

            if (pipes[i].x + pipeConfig.width < 0) pipes.splice(i, 1);
        }

        // Loop de Partículas Globais
        for (let i = particles.length - 1; i >= 0; i--) {
            particles[i].update(dt); particles[i].draw();
            if (particles[i].alpha <= 0) particles.splice(i, 1);
        }

        // Broadcast contínuo de posição para a rede (Aprox. 60Hz)
        if (isMultiplayer && Math.random() > 0.3) networkSendPos();

        gameEngine = requestAnimationFrame(update);
    }

    function initialDraw() {
        if (gameActive) return; // Interrompe o loop inicial se o jogo já foi iniciado
        let now = performance.now();
        let dt = (now - lastTime) / 1000;
        if (dt > 0.1) dt = 0.1;
        lastTime = now;
        background.updateAndDraw(dt);
        requestAnimationFrame(initialDraw);
    }
    initialDraw();
});
