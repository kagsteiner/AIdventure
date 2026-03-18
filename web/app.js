/**
 * AIdventure — Web Client
 *
 * Connects to the game server via WebSocket, renders the narrative,
 * handles push-to-talk recording, and optionally runs a voice-only loop.
 */

(function () {
  "use strict";

  const authOverlay = document.getElementById("auth-overlay");
  const authInput = document.getElementById("auth-input");
  const authBtn = document.getElementById("auth-btn");
  const connectOverlay = document.getElementById("connect-overlay");
  const connectStatus = document.getElementById("connect-status");
  const reconnectBtn = document.getElementById("reconnect-btn");
  const gameEl = document.getElementById("game");
  const statusBar = document.getElementById("status-bar");
  const voiceModeBtn = document.getElementById("voice-mode-btn");
  const newStoryBtn = document.getElementById("new-story-btn");
  const voiceModeScreen = document.getElementById("voice-mode-screen");
  const voiceModeTitle = document.getElementById("voice-mode-title");
  const voiceModeDescription = document.getElementById("voice-mode-description");
  const voiceModeActionBtn = document.getElementById("voice-mode-action-btn");
  const voiceModeStatus = document.getElementById("voice-mode-status");
  const voiceModeTranscript = document.getElementById("voice-mode-transcript");
  const voiceModeExitBtn = document.getElementById("voice-mode-exit-btn");
  const narrativeArea = document.getElementById("narrative-area");
  const narrativeContent = document.getElementById("narrative-content");
  const menuArea = document.getElementById("menu-area");
  const thinkingEl = document.getElementById("thinking-indicator");
  const inputControls = document.getElementById("input-controls");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-btn");

  const VOICE_STORAGE_KEY = "aidventure.voice-mode";
  const VOICE_SCENE_CACHE_KEY = "aidventure.voice-scene-cache";
  const VOICE_TTS_CACHE_KEY = "aidventure.voice-tts-cache";
  const MAX_RECORDING_MS = 15000;
  const SILENCE_DURATION_MS = 1300;
  const SILENCE_THRESHOLD = 0.035;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const CONNECTION_STATES = {
    DISCONNECTED: "disconnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
  };
  const VOICE_STATES = {
    IDLE: "idle",
    INTERRUPTED: "interrupted",
    READY: "ready",
    NARRATING_SCENE: "narratingScene",
    AWAITING_INPUT: "awaitingInput",
    LISTENING_ACTION: "listeningAction",
    TRANSCRIBING_ACTION: "transcribingAction",
    CONFIRMING_ACTION: "confirmingAction",
    SENDING_ACTION: "sendingAction",
    WAITING_STORY: "waitingStory",
  };
  const RESUME_POLICIES = {
    REPLAY_SCENE: "replay_scene",
    REPLAY_CHOICES: "replay_choices",
    WAIT_FOR_NEXT_SCENE: "wait_for_next_scene",
  };

  let ws = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let waitingForInput = false;
  let password = "";
  let currentAudioElement = null;
  let currentBlobUrl = null;
  let currentRecordingCancel = null;
  let transcriptionCounter = 0;
  let ttsCounter = 0;

  const pendingTranscriptions = new Map();
  const pendingTts = new Map();
  const readySound = new Audio("sound/sound.mp3");
  const narrationAudio = new Audio();

  readySound.preload = "auto";
  narrationAudio.preload = "auto";
  narrationAudio.playsInline = true;

  const persistedVoiceState = loadVoiceState();
  const sceneState = {
    message: null,
    key: null,
    turnId: null,
    isReplay: false,
  };

  const voiceMode = {
    open: Boolean(persistedVoiceState.armed),
    armed: Boolean(persistedVoiceState.armed),
    started: false,
    needsRestart: Boolean(persistedVoiceState.needsRestart),
    connectionState: persistedVoiceState.connectionState || CONNECTION_STATES.DISCONNECTED,
    state: persistedVoiceState.state || (persistedVoiceState.needsRestart ? VOICE_STATES.INTERRUPTED : VOICE_STATES.IDLE),
    resumePolicy: persistedVoiceState.resumePolicy || migrateResumePolicy(persistedVoiceState.resumeMode),
    turnId: persistedVoiceState.turnId || null,
    sceneKey: persistedVoiceState.sceneKey || null,
    playbackKind: persistedVoiceState.playbackKind || "none",
    playbackCompleted: Boolean(persistedVoiceState.playbackCompleted),
    awaitingInput: Boolean(persistedVoiceState.awaitingInput),
    actionCommitted: Boolean(persistedVoiceState.actionCommitted),
    pendingChoices: Array.isArray(persistedVoiceState.pendingChoices) ? persistedVoiceState.pendingChoices : [],
    lastTranscript: persistedVoiceState.lastTranscript || "",
    flowId: 0,
    queue: Promise.resolve(),
    promptSceneKey: null,
  };

  function migrateResumePolicy(legacyMode) {
    if (legacyMode === "choices_only") return RESUME_POLICIES.REPLAY_CHOICES;
    if (legacyMode === "full_scene") return RESUME_POLICIES.REPLAY_SCENE;
    return RESUME_POLICIES.REPLAY_SCENE;
  }

  function loadVoiceState() {
    try {
      const raw = localStorage.getItem(VOICE_STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }

  function saveVoiceState() {
    const payload = {
      armed: voiceMode.armed,
      needsRestart: voiceMode.needsRestart,
      connectionState: voiceMode.connectionState,
      state: voiceMode.state,
      resumePolicy: voiceMode.resumePolicy,
      turnId: voiceMode.turnId,
      sceneKey: voiceMode.sceneKey,
      playbackKind: voiceMode.playbackKind,
      playbackCompleted: voiceMode.playbackCompleted,
      awaitingInput: voiceMode.awaitingInput,
      actionCommitted: voiceMode.actionCommitted,
      pendingChoices: voiceMode.pendingChoices,
      lastTranscript: voiceMode.lastTranscript,
    };
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(payload));
  }

  function clearVoiceState() {
    localStorage.removeItem(VOICE_STORAGE_KEY);
  }

  function clearLegacyClientAudioCaches() {
    try { localStorage.removeItem(VOICE_SCENE_CACHE_KEY); } catch {}
    try { localStorage.removeItem(VOICE_TTS_CACHE_KEY); } catch {}
  }

  function getWSUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    let basePath = location.pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }
    let url = `${proto}//${location.host}${basePath}`;
    if (password) url += `?token=${encodeURIComponent(password)}`;
    return url;
  }

  function hashString(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return `scene-${(hash >>> 0).toString(36)}`;
  }

  function getSceneKey(msg) {
    return hashString(JSON.stringify({
      narrative: msg?.narrative || "",
      asciiArt: msg?.asciiArt || "",
      choices: msg?.choices || [],
    }));
  }

  function getTurnId(msg) {
    return msg?.turnId || getSceneKey(msg);
  }

  function normalizeText(text) {
    return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function parseConfirmation(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;

    const yesWords = ["yes", "yeah", "yep", "correct", "confirm", "right", "do it", "sure"];
    const noWords = ["no", "nope", "wrong", "incorrect", "again", "retry", "try again"];

    if (yesWords.some((word) => normalized === word || normalized.includes(word))) return true;
    if (noWords.some((word) => normalized === word || normalized.includes(word))) return false;
    return null;
  }

  function getSupportedRecorderMimeType() {
    if (!window.MediaRecorder) return "";
    if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
    return "";
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === "string" ? reader.result.split(",")[1] : "";
        if (!result) reject(new Error("Could not encode audio."));
        else resolve(result);
      };
      reader.onerror = () => reject(new Error("Could not read audio."));
      reader.readAsDataURL(blob);
    });
  }

  function setVoiceStatus(text, transcript) {
    voiceModeStatus.textContent = text || "";
    if (transcript) {
      voiceMode.lastTranscript = transcript;
      voiceModeTranscript.textContent = transcript;
      voiceModeTranscript.classList.remove("hidden");
    } else {
      voiceMode.lastTranscript = "";
      voiceModeTranscript.textContent = "";
      voiceModeTranscript.classList.add("hidden");
    }
    saveVoiceState();
    syncVoiceModeUI();
  }

  function getVoiceActionLabel() {
    if (voiceMode.needsRestart) return "Restart Voice Mode";
    if (!voiceMode.started) return "Start Voice Mode";
    switch (voiceMode.state) {
      case VOICE_STATES.NARRATING_SCENE:
        return "Narrating...";
      case VOICE_STATES.AWAITING_INPUT:
        return "Awaiting Input...";
      case VOICE_STATES.LISTENING_ACTION:
        return "Listening...";
      case VOICE_STATES.TRANSCRIBING_ACTION:
        return "Transcribing...";
      case VOICE_STATES.CONFIRMING_ACTION:
        return "Confirming...";
      case VOICE_STATES.SENDING_ACTION:
        return "Sending Action...";
      case VOICE_STATES.WAITING_STORY:
        return "Waiting For Story...";
      default:
        return "Voice Mode Running";
    }
  }

  function setConnectionState(state) {
    voiceMode.connectionState = state;
    saveVoiceState();
  }

  function setVoiceState(state, options) {
    const next = options || {};
    voiceMode.state = state;
    if ("turnId" in next) voiceMode.turnId = next.turnId;
    if ("sceneKey" in next) voiceMode.sceneKey = next.sceneKey;
    if ("resumePolicy" in next) voiceMode.resumePolicy = next.resumePolicy;
    if ("playbackKind" in next) voiceMode.playbackKind = next.playbackKind;
    if ("playbackCompleted" in next) voiceMode.playbackCompleted = next.playbackCompleted;
    if ("awaitingInput" in next) voiceMode.awaitingInput = next.awaitingInput;
    if ("actionCommitted" in next) voiceMode.actionCommitted = next.actionCommitted;
    if ("pendingChoices" in next) voiceMode.pendingChoices = next.pendingChoices;
    saveVoiceState();
    syncVoiceModeUI();
  }

  function syncVoiceModeUI() {
    document.body.classList.toggle("voice-mode-open", voiceMode.open);
    voiceModeScreen.classList.toggle("hidden", !voiceMode.open);

    voiceModeTitle.textContent = voiceMode.needsRestart ? "Voice mode needs a restart" : "Hands-free play";
    voiceModeDescription.textContent = voiceMode.needsRestart
      ? "Restart voice mode to reconnect audio and microphone access. The app will resume from the current story state."
      : "Start narration, then speak your choice after the prompt. The app will repeat what it heard and ask for a yes or no confirmation.";

    voiceModeActionBtn.textContent = getVoiceActionLabel();
    voiceModeActionBtn.disabled = voiceMode.started && !voiceMode.needsRestart;
    voiceModeExitBtn.textContent = voiceMode.armed || voiceMode.started ? "Stop Voice Mode" : "Back to normal view";
  }

  function connect() {
    setConnectionState(CONNECTION_STATES.CONNECTING);
    connectOverlay.classList.remove("hidden");
    reconnectBtn.classList.add("hidden");
    connectStatus.textContent = "Connecting...";
    gameEl.classList.add("hidden");

    ws = new WebSocket(getWSUrl());

    ws.onopen = () => {
      setConnectionState(CONNECTION_STATES.CONNECTED);
      connectOverlay.classList.add("hidden");
      authOverlay.classList.add("hidden");
      gameEl.classList.remove("hidden");
      narrativeContent.innerHTML = "";
      statusBar.innerHTML = "";
      waitingForInput = false;
      sceneState.message = null;
      sceneState.key = null;
      sceneState.turnId = null;
      sceneState.isReplay = false;
      if (!voiceMode.started) {
        setVoiceState(voiceMode.needsRestart ? VOICE_STATES.INTERRUPTED : VOICE_STATES.IDLE);
      }
      syncVoiceModeUI();
    };

    ws.onclose = (e) => {
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
      rejectPendingTranscriptions("Connection lost.");
      rejectPendingTts("Connection lost.");
      if (e.code === 4001) {
        authOverlay.classList.remove("hidden");
        connectOverlay.classList.add("hidden");
        return;
      }
      if (voiceMode.armed || voiceMode.started) markVoiceModeForRestart();
      connectOverlay.classList.remove("hidden");
      gameEl.classList.add("hidden");
      connectStatus.textContent = "Disconnected.";
      reconnectBtn.classList.remove("hidden");
    };

    ws.onerror = () => {};

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {}
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "banner":
        appendTextWithAudio("Welcome to AIdventure", msg.audio);
        if (voiceMode.started && msg.audio) queueVoiceAudio(msg.audio, "Speaking welcome.");
        break;

      case "scene":
        hideThinking();
        renderScene(msg);
        setSceneState(msg, false);
        if (!voiceMode.started) playReadySound();
        else startVoiceSceneFlow(msg, false);
        break;

      case "replay":
        appendSessionDivider();
        renderScene(msg);
        setSceneState(msg, true);
        if (voiceMode.started) startVoiceSceneFlow(msg, true);
        break;

      case "status":
        renderStatus(msg.state);
        newStoryBtn.classList.remove("hidden");
        break;

      case "newStory":
        narrativeContent.innerHTML = "";
        statusBar.innerHTML = "";
        waitingForInput = false;
        stopAudio();
        setVoiceState(VOICE_STATES.IDLE, {
          awaitingInput: false,
          actionCommitted: false,
          playbackKind: "none",
          playbackCompleted: true,
          pendingChoices: [],
        });
        appendTextWithAudio(msg.text, msg.audio);
        if (voiceMode.started && msg.audio) queueVoiceAudio(msg.audio, "Starting a new story.");
        break;

      case "thinking":
        showThinking();
        if (voiceMode.started) {
          setVoiceState(VOICE_STATES.WAITING_STORY, {
            awaitingInput: false,
            resumePolicy: RESUME_POLICIES.WAIT_FOR_NEXT_SCENE,
          });
          setVoiceStatus("The story is advancing...");
        }
        break;

      case "inputRequest":
        waitingForInput = true;
        hideThinking();
        setVoiceState(VOICE_STATES.AWAITING_INPUT, {
          turnId: sceneState.turnId,
          sceneKey: sceneState.key,
          awaitingInput: true,
          actionCommitted: false,
          pendingChoices: sceneState.message?.choices || [],
          resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
        });
        if (voiceMode.started) {
          if (voiceMode.actionCommitted && sceneState.isReplay && voiceMode.turnId === sceneState.turnId) {
            setVoiceState(VOICE_STATES.AWAITING_INPUT, {
              awaitingInput: true,
              actionCommitted: false,
              resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
            });
          }
          enqueueVoiceStep(() => runVoiceInputCycle());
        } else {
          enableInput();
        }
        break;

      case "menu":
        renderMenu(msg.items, msg.audio);
        if (voiceMode.started && msg.audio) queueVoiceAudio(msg.audio, "Speaking menu options.");
        break;

      case "message":
        appendTextWithAudio(msg.text, msg.audio);
        if (voiceMode.started && msg.audio) {
          queueVoiceAudio(msg.audio, msg.text || "Speaking.");
        }
        break;

      case "error":
        appendError(msg.text);
        if (voiceMode.started) setVoiceStatus(msg.text || "Something went wrong.");
        break;

      case "transcription":
        appendTranscription(msg.text);
        break;

      case "transcriptionResult":
        resolvePendingTranscription(msg);
        break;

      case "ttsResult":
        resolvePendingTts(msg);
        break;

      case "quit":
        appendTextWithAudio(msg.text, msg.audio);
        disableInput();
        setVoiceState(VOICE_STATES.IDLE, {
          awaitingInput: false,
          actionCommitted: false,
          playbackKind: "none",
          playbackCompleted: true,
          pendingChoices: [],
        });
        if (voiceMode.started && msg.audio) queueVoiceAudio(msg.audio, "Story paused.");
        break;
    }
  }

  function stopAudio() {
    if (currentAudioElement) {
      currentAudioElement.pause();
      currentAudioElement = null;
    }
    narrationAudio.pause();
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }

  async function playAudioBase64(base64) {
    if (!base64) return;
    stopAudio();

    try {
      const bytes = base64ToBytes(base64);
      const blob = new Blob([bytes], { type: "audio/mpeg" });
      currentBlobUrl = URL.createObjectURL(blob);
      narrationAudio.src = currentBlobUrl;
      currentAudioElement = narrationAudio;

      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }

      await new Promise((resolve, reject) => {
        const onEnded = () => {
          narrationAudio.removeEventListener("ended", onEnded);
          narrationAudio.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          narrationAudio.removeEventListener("ended", onEnded);
          narrationAudio.removeEventListener("error", onError);
          reject(new Error("Audio playback failed."));
        };
        narrationAudio.addEventListener("ended", onEnded);
        narrationAudio.addEventListener("error", onError);
        narrationAudio.play().catch((err) => {
          narrationAudio.removeEventListener("ended", onEnded);
          narrationAudio.removeEventListener("error", onError);
          reject(err);
        });
      });
    } finally {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }
      narrationAudio.removeAttribute("src");
      narrationAudio.load();
      currentAudioElement = null;
    }
  }

  async function speakPrompt(text) {
    if (!text) return;

    stopAudio();
    try {
      const audio = await requestTts(text);
      if (audio) {
        await playAudioBase64(audio);
        return;
      }
    } catch {}

    if (!window.speechSynthesis) {
      setVoiceStatus(text);
      return;
    }

    await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        resolve();
      }
    });
  }

  function makePlayButton(base64) {
    if (!base64) return null;
    const btn = document.createElement("button");
    btn.className = "speak-btn";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg> Speak';
    btn.addEventListener("click", () => {
      playAudioBase64(base64).catch((err) => {
        appendError("Audio play failed: " + err.message);
      });
    });
    return btn;
  }

  function playReadySound() {
    try {
      readySound.currentTime = 0;
      readySound.play().catch(() => {});
    } catch {}
  }

  function renderScene(msg) {
    const block = document.createElement("div");
    block.className = "narrative-block";

    if (msg.asciiArt) {
      const pre = document.createElement("div");
      pre.className = "ascii-art";
      pre.textContent = msg.asciiArt;
      block.appendChild(pre);
    }

    const paragraphs = (msg.narrative || "").split("\n\n");
    for (const para of paragraphs) {
      if (!para.trim()) continue;
      const p = document.createElement("p");
      p.textContent = para.trim();
      block.appendChild(p);
    }

    const playBtn = makePlayButton(msg.audio);
    if (playBtn) block.appendChild(playBtn);

    if (msg.choices && msg.choices.length > 0) {
      const choices = document.createElement("div");
      choices.className = "choices";
      msg.choices.forEach((text, i) => {
        const card = document.createElement("div");
        card.className = "choice-card";
        card.textContent = `${i + 1}. ${text}`;
        card.addEventListener("click", () => {
          if (waitingForInput) sendText(text);
        });
        choices.appendChild(card);
      });
      block.appendChild(choices);
    }

    narrativeContent.appendChild(block);
    scrollToBottom();
  }

  function renderStatus(state) {
    if (!state) return;
    const parts = [];
    if (state.location) parts.push(state.location);
    if (state.sub_location) parts.push(state.sub_location);
    if (state.day) parts.push(`Day ${state.day}`);
    if (state.time_of_day) parts.push(state.time_of_day);
    if (state.health && state.health !== "good") parts.push(`HP: ${state.health}`);
    if (state.gold !== undefined) parts.push(`${state.gold}g`);

    statusBar.innerHTML = parts.map((part) => `<span class="badge">${part}</span>`).join("");
  }

  function renderMenu(items, audio) {
    menuArea.innerHTML = "";
    menuArea.classList.remove("hidden");
    narrativeArea.classList.add("hidden");

    const heading = document.createElement("h2");
    heading.textContent = "Choose Your Adventure";
    menuArea.appendChild(heading);

    const playBtn = makePlayButton(audio);
    if (playBtn) menuArea.appendChild(playBtn);

    items.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "menu-card";
      card.innerHTML = `<div class="menu-name">${item.number}. ${item.name}</div><div class="menu-desc">${item.description}</div>`;
      card.addEventListener("click", () => {
        sendJSON({ type: "menuChoice", index: idx });
        menuArea.classList.add("hidden");
        narrativeArea.classList.remove("hidden");
      });
      menuArea.appendChild(card);
    });
  }

  function appendTextWithAudio(text, audio) {
    if (!text && !audio) return;
    const el = document.createElement("div");
    el.className = "narrative-block";
    if (text) {
      const p = document.createElement("p");
      p.textContent = text;
      el.appendChild(p);
    }
    const playBtn = makePlayButton(audio);
    if (playBtn) el.appendChild(playBtn);
    narrativeContent.appendChild(el);
    scrollToBottom();
  }

  function appendSessionDivider() {
    const el = document.createElement("div");
    el.className = "session-divider";
    el.textContent = "↩ Last session";
    narrativeContent.appendChild(el);
  }

  function appendError(text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "error-text";
    el.textContent = text;
    narrativeContent.appendChild(el);
    scrollToBottom();
  }

  function appendTranscription(text) {
    const el = document.createElement("div");
    el.className = "transcription";
    el.textContent = `You said: "${text}"`;
    narrativeContent.appendChild(el);
    scrollToBottom();
  }

  function appendPlayerAction(text) {
    const el = document.createElement("div");
    el.className = "player-action";
    el.textContent = `> ${text}`;
    narrativeContent.appendChild(el);
    scrollToBottom();
  }

  function showThinking() {
    thinkingEl.classList.remove("hidden");
    inputControls.classList.add("hidden");
  }

  function hideThinking() {
    thinkingEl.classList.add("hidden");
  }

  function enableInput() {
    inputControls.classList.remove("hidden");
    textInput.value = "";
  }

  function disableInput() {
    inputControls.classList.add("hidden");
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      narrativeArea.scrollTop = narrativeArea.scrollHeight;
    });
  }

  function setSceneState(msg, isReplay, updateVoiceTurnContext) {
    sceneState.message = msg;
    sceneState.key = getSceneKey(msg);
    sceneState.turnId = getTurnId(msg);
    sceneState.isReplay = isReplay;
    if (updateVoiceTurnContext === false) return;
    setVoiceState(voiceMode.state, {
      turnId: sceneState.turnId,
      sceneKey: sceneState.key,
      pendingChoices: Array.isArray(msg?.choices) ? msg.choices : [],
    });
  }

  function sendJSON(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendText(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || !waitingForInput) return;
    waitingForInput = false;
    stopAudio();
    setVoiceState(VOICE_STATES.SENDING_ACTION, {
      awaitingInput: false,
      actionCommitted: true,
      playbackKind: "none",
      playbackCompleted: true,
      resumePolicy: RESUME_POLICIES.WAIT_FOR_NEXT_SCENE,
    });
    appendPlayerAction(trimmed);
    sendJSON({ type: "text", text: trimmed });
    textInput.value = "";
    disableInput();

    if (voiceMode.started) {
      voiceMode.promptSceneKey = sceneState.key;
      setVoiceState(VOICE_STATES.WAITING_STORY, {
        awaitingInput: false,
        actionCommitted: true,
        resumePolicy: RESUME_POLICIES.WAIT_FOR_NEXT_SCENE,
      });
      setVoiceStatus("Waiting for the story to continue.", `You said: "${trimmed}"`);
    }
  }

  function sendAudio(base64) {
    if (!waitingForInput) return;
    waitingForInput = false;
    stopAudio();
    sendJSON({ type: "audio", data: base64 });
    disableInput();
  }

  function requestTranscription(base64) {
    return new Promise((resolve, reject) => {
      const requestId = `tx-${Date.now()}-${++transcriptionCounter}`;
      const timeoutId = window.setTimeout(() => {
        pendingTranscriptions.delete(requestId);
        reject(new Error("Transcription timed out."));
      }, 30000);

      pendingTranscriptions.set(requestId, {
        resolve: (msg) => {
          clearTimeout(timeoutId);
          if (msg.error) reject(new Error(msg.error));
          else resolve((msg.text || "").trim());
        },
        reject: (message) => {
          clearTimeout(timeoutId);
          reject(new Error(message));
        },
      });

      sendJSON({ type: "transcribeAudio", data: base64, requestId });
    });
  }

  function resolvePendingTranscription(msg) {
    const pending = pendingTranscriptions.get(msg.requestId);
    if (!pending) return;
    pendingTranscriptions.delete(msg.requestId);
    pending.resolve(msg);
  }

  function rejectPendingTranscriptions(message) {
    for (const [requestId, pending] of pendingTranscriptions.entries()) {
      pending.reject(message);
      pendingTranscriptions.delete(requestId);
    }
  }

  function requestTts(text) {
    return new Promise((resolve, reject) => {
      const requestId = `tts-${Date.now()}-${++ttsCounter}`;
      const timeoutId = window.setTimeout(() => {
        pendingTts.delete(requestId);
        reject(new Error("Speech generation timed out."));
      }, 45000);

      pendingTts.set(requestId, {
        resolve: (msg) => {
          clearTimeout(timeoutId);
          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.audio || null);
        },
        reject: (message) => {
          clearTimeout(timeoutId);
          reject(new Error(message));
        },
      });

      sendJSON({ type: "synthesizeText", text, requestId });
    });
  }

  function resolvePendingTts(msg) {
    const pending = pendingTts.get(msg.requestId);
    if (!pending) return;
    pendingTts.delete(msg.requestId);
    pending.resolve(msg);
  }

  function rejectPendingTts(message) {
    for (const [requestId, pending] of pendingTts.entries()) {
      pending.reject(message);
      pendingTts.delete(requestId);
    }
  }

  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedRecorderMimeType();
      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(stream, options);
      recordedChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordedChunks.length === 0) return;
        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || mimeType || "audio/webm" });
        blobToBase64(blob)
          .then((base64) => sendAudio(base64))
          .catch(() => appendError("Could not encode your recording."));
      };

      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add("recording");
    } catch {
      appendError("Microphone access denied. Please use text input.");
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    micBtn.classList.remove("recording");
    mediaRecorder.stop();
  }

  function resetVoiceFlow() {
    voiceMode.flowId += 1;
    voiceMode.queue = Promise.resolve();
    voiceMode.promptSceneKey = null;
    cancelVoiceCapture();
    stopAudio();
  }

  function enqueueVoiceStep(step) {
    const flowId = voiceMode.flowId;
    voiceMode.queue = voiceMode.queue.catch(() => {}).then(async () => {
      if (!voiceMode.started || voiceMode.needsRestart || flowId !== voiceMode.flowId) return;
      await step();
    });
    return voiceMode.queue;
  }

  function queueVoiceAudio(base64, statusText) {
    enqueueVoiceStep(async () => {
      setVoiceState(VOICE_STATES.NARRATING_SCENE, {
        turnId: sceneState.turnId,
        sceneKey: sceneState.key,
        playbackKind: "scene",
        playbackCompleted: false,
        awaitingInput: false,
        actionCommitted: false,
      });
      setVoiceStatus(statusText || "Speaking...");
      await playAudioBase64(base64);
      if (voiceMode.state === VOICE_STATES.NARRATING_SCENE) {
        setVoiceState(waitingForInput ? VOICE_STATES.AWAITING_INPUT : VOICE_STATES.READY, {
          playbackKind: "scene",
          playbackCompleted: true,
          awaitingInput: waitingForInput,
          resumePolicy: waitingForInput ? RESUME_POLICIES.REPLAY_CHOICES : RESUME_POLICIES.REPLAY_CHOICES,
        });
        setVoiceStatus(waitingForInput ? "Ready for your next action." : "Waiting for the story.");
      }
    });
  }

  function getResumeNarrationMode(sceneKey, isReplay) {
    if (!isReplay) return "full_scene";
    if (
      voiceMode.resumePolicy === RESUME_POLICIES.REPLAY_CHOICES &&
      voiceMode.sceneKey === sceneKey
    ) {
      return "choices_only";
    }
    return "full_scene";
  }

  function buildChoicePrompt(choices) {
    if (!choices || choices.length === 0) {
      return "What would you like to do?";
    }
    const numberedChoices = choices.map((choice, index) => `Option ${index + 1}: ${choice}.`).join(" ");
    return `${numberedChoices} What would you like to do?`;
  }

  function buildNarrationFallback(scene) {
    const choices = scene?.choices?.length ? ` ${buildChoicePrompt(scene.choices)}` : "";
    return `${scene?.narrative || "The current scene is ready."}${choices}`;
  }

  function clearResumeHint() {
    voiceMode.needsRestart = false;
    saveVoiceState();
  }

  function startVoiceSceneFlow(msg, isReplay) {
    if (!voiceMode.started) return;

    const incomingTurnId = getTurnId(msg);
    const incomingSceneKey = getSceneKey(msg);
    const previousTurnId = voiceMode.turnId;
    const previousActionCommitted = voiceMode.actionCommitted;
    const previousResumePolicy = voiceMode.resumePolicy;

    setSceneState(msg, isReplay, false);
    resetVoiceFlow();

    enqueueVoiceStep(async () => {
      if (
        isReplay &&
        previousResumePolicy === RESUME_POLICIES.WAIT_FOR_NEXT_SCENE &&
        previousActionCommitted &&
        previousTurnId === incomingTurnId
      ) {
        setSceneState(msg, isReplay, false);
        setVoiceState(VOICE_STATES.WAITING_STORY, {
          turnId: previousTurnId,
          sceneKey: incomingSceneKey,
          awaitingInput: false,
          actionCommitted: true,
          playbackKind: "none",
          playbackCompleted: true,
          resumePolicy: RESUME_POLICIES.WAIT_FOR_NEXT_SCENE,
        });
        setVoiceStatus("Waiting for the next story update.");
        return;
      }

      setSceneState(msg, isReplay);
      const narrationMode = getResumeNarrationMode(sceneState.key, isReplay);

      if (narrationMode === "choices_only") {
        setVoiceState(VOICE_STATES.NARRATING_SCENE, {
          playbackKind: "choice_prompt",
          playbackCompleted: false,
          awaitingInput: true,
          resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
        });
        setVoiceStatus("Restarted. Retelling the choices.");
        await speakPrompt(buildChoicePrompt(msg.choices));
      } else if (msg.audio) {
        setVoiceState(VOICE_STATES.NARRATING_SCENE, {
          playbackKind: "scene",
          playbackCompleted: false,
          awaitingInput: false,
          actionCommitted: false,
          resumePolicy: RESUME_POLICIES.REPLAY_SCENE,
        });
        setVoiceStatus("Narrating the current scene.");
        await playAudioBase64(msg.audio);
      } else {
        setVoiceState(VOICE_STATES.NARRATING_SCENE, {
          playbackKind: "scene",
          playbackCompleted: false,
          awaitingInput: false,
          actionCommitted: false,
          resumePolicy: RESUME_POLICIES.REPLAY_SCENE,
        });
        setVoiceStatus("Narrating the current scene.");
        await speakPrompt(buildNarrationFallback(msg));
      }

      clearResumeHint();

      if (waitingForInput) {
        setVoiceState(VOICE_STATES.AWAITING_INPUT, {
          playbackCompleted: true,
          awaitingInput: true,
          pendingChoices: msg.choices || [],
          resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
        });
        await runVoiceInputCycle({ skipChoicePrompt: true });
      } else {
        setVoiceState(VOICE_STATES.READY, {
          playbackCompleted: true,
          awaitingInput: false,
          pendingChoices: msg.choices || [],
          resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
        });
        setVoiceStatus("Waiting for the story to continue.");
      }
    });
  }

  async function primeVoiceMode() {
    if (!window.MediaRecorder) {
      throw new Error("This browser does not support voice recording.");
    }

    try {
      narrationAudio.src =
        "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACcQCA" +
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
      await narrationAudio.play();
      narrationAudio.pause();
      narrationAudio.currentTime = 0;
      narrationAudio.removeAttribute("src");
      narrationAudio.load();
    } catch {}

  }

  async function startVoiceMode() {
    voiceMode.open = true;
    setVoiceState(VOICE_STATES.READY);
    setVoiceStatus("Preparing audio...");

    try {
      await primeVoiceMode();
    } catch (err) {
      voiceMode.started = false;
      voiceMode.needsRestart = false;
      voiceMode.armed = false;
      clearVoiceState();
      setVoiceState(VOICE_STATES.IDLE);
      setVoiceStatus(err.message || "Could not start voice mode.");
      appendError(err.message || "Could not start voice mode.");
      return;
    }

    voiceMode.armed = true;
    voiceMode.started = true;
    voiceMode.needsRestart = false;
    saveVoiceState();
    syncVoiceModeUI();

    if (sceneState.message) {
      startVoiceSceneFlow(sceneState.message, sceneState.isReplay || voiceMode.resumePolicy !== RESUME_POLICIES.REPLAY_SCENE);
      return;
    }

    if (voiceMode.resumePolicy === RESUME_POLICIES.WAIT_FOR_NEXT_SCENE && voiceMode.turnId) {
      setVoiceState(VOICE_STATES.WAITING_STORY, {
        awaitingInput: false,
        actionCommitted: true,
      });
      setVoiceStatus("Voice mode is ready. Waiting for the next story update.");
    } else {
      setVoiceState(VOICE_STATES.READY);
      setVoiceStatus("Voice mode is ready. It will begin when a scene arrives.");
    }
  }

  function stopVoiceMode() {
    voiceMode.open = false;
    voiceMode.armed = false;
    voiceMode.started = false;
    voiceMode.needsRestart = false;
    resetVoiceFlow();
    setVoiceState(VOICE_STATES.IDLE, {
      resumePolicy: RESUME_POLICIES.REPLAY_SCENE,
      turnId: null,
      sceneKey: null,
      playbackKind: "none",
      playbackCompleted: false,
      awaitingInput: false,
      actionCommitted: false,
      pendingChoices: [],
    });
    clearVoiceState();
    setVoiceStatus("Waiting to start.");
    syncVoiceModeUI();
  }

  function rememberVoiceResume() {
    let resumePolicy = RESUME_POLICIES.REPLAY_SCENE;
    if (voiceMode.state === VOICE_STATES.NARRATING_SCENE) {
      resumePolicy = voiceMode.playbackKind === "scene"
        ? RESUME_POLICIES.REPLAY_SCENE
        : RESUME_POLICIES.REPLAY_CHOICES;
    } else if (
      voiceMode.state === VOICE_STATES.AWAITING_INPUT ||
      voiceMode.state === VOICE_STATES.LISTENING_ACTION ||
      voiceMode.state === VOICE_STATES.TRANSCRIBING_ACTION ||
      voiceMode.state === VOICE_STATES.CONFIRMING_ACTION
    ) {
      resumePolicy = RESUME_POLICIES.REPLAY_CHOICES;
    } else if (voiceMode.state === VOICE_STATES.READY) {
      resumePolicy = voiceMode.pendingChoices.length > 0
        ? RESUME_POLICIES.REPLAY_CHOICES
        : RESUME_POLICIES.REPLAY_SCENE;
    } else if (
      voiceMode.state === VOICE_STATES.SENDING_ACTION ||
      voiceMode.state === VOICE_STATES.WAITING_STORY
    ) {
      resumePolicy = RESUME_POLICIES.WAIT_FOR_NEXT_SCENE;
    }
    setVoiceState(voiceMode.state, {
      turnId: sceneState.turnId || voiceMode.turnId,
      sceneKey: sceneState.key || voiceMode.sceneKey,
      resumePolicy,
      pendingChoices: sceneState.message?.choices || voiceMode.pendingChoices,
    });
  }

  function markVoiceModeForRestart() {
    if (!voiceMode.armed && !voiceMode.started) return;

    rememberVoiceResume();

    voiceMode.started = false;
    voiceMode.needsRestart = true;
    voiceMode.open = true;
    cancelVoiceCapture();
    stopAudio();
    setVoiceState(VOICE_STATES.INTERRUPTED);
    setVoiceStatus("Voice mode paused. Restart when you are ready.");
  }

  function cancelVoiceCapture() {
    if (currentRecordingCancel) {
      currentRecordingCancel();
      currentRecordingCancel = null;
    }
  }

  async function recordUntilPause() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getSupportedRecorderMimeType();
    const options = mimeType ? { mimeType } : {};
    const recorder = new MediaRecorder(stream, options);
    const analyserContext = AudioContextCtor ? new AudioContextCtor() : null;
    const analyser = analyserContext ? analyserContext.createAnalyser() : null;
    const inputSource = analyserContext ? analyserContext.createMediaStreamSource(stream) : null;
    const chunks = [];

    if (inputSource && analyser) {
      inputSource.connect(analyser);
      analyser.fftSize = 2048;
    }

    return new Promise((resolve, reject) => {
      let stopped = false;
      let heardSpeech = false;
      let quietSince = Date.now();
      const startedAt = Date.now();
      const samples = analyser ? new Uint8Array(analyser.fftSize) : null;

      const cleanup = async () => {
        currentRecordingCancel = null;
        window.clearInterval(monitorId);
        stream.getTracks().forEach((track) => track.stop());
        if (inputSource) {
          try { inputSource.disconnect(); } catch {}
        }
        if (analyser) {
          try { analyser.disconnect(); } catch {}
        }
        if (analyserContext && analyserContext.state !== "closed") {
          try { await analyserContext.close(); } catch {}
        }
      };

      const stopRecorder = () => {
        if (stopped) return;
        stopped = true;
        try { recorder.stop(); } catch {}
      };

      currentRecordingCancel = stopRecorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onerror = async () => {
        await cleanup();
        reject(new Error("Recording failed."));
      };

      recorder.onstop = async () => {
        await cleanup();
        if (chunks.length === 0) {
          reject(new Error("No audio recorded."));
          return;
        }
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      };

      const monitorId = window.setInterval(() => {
        const now = Date.now();
        if (!analyser || !samples) {
          if (now - startedAt >= MAX_RECORDING_MS) stopRecorder();
          return;
        }

        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
          const sample = (samples[i] - 128) / 128;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / samples.length);

        if (rms > SILENCE_THRESHOLD) {
          heardSpeech = true;
          quietSince = now;
        } else if (heardSpeech && now - quietSince >= SILENCE_DURATION_MS) {
          stopRecorder();
        } else if (!heardSpeech && now - startedAt >= MAX_RECORDING_MS) {
          stopRecorder();
        }
      }, 120);

      recorder.start();
    });
  }

  async function listenAndTranscribe(statusText) {
    setVoiceState(VOICE_STATES.LISTENING_ACTION, {
      awaitingInput: true,
      playbackKind: "choice_prompt",
      playbackCompleted: true,
      resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
    });
    setVoiceStatus("Requesting microphone access...");
    const blob = await recordUntilPause();
    setVoiceStatus(statusText || "Listening...");
    setVoiceState(VOICE_STATES.TRANSCRIBING_ACTION, {
      awaitingInput: true,
      resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
    });
    setVoiceStatus("Transcribing...");
    const base64 = await blobToBase64(blob);
    return requestTranscription(base64);
  }

  async function runVoiceInputCycle(options) {
    if (!voiceMode.started || !waitingForInput || voiceMode.promptSceneKey === sceneState.key) return;

    const skipChoicePrompt = Boolean(options?.skipChoicePrompt);
    voiceMode.promptSceneKey = sceneState.key;

    while (voiceMode.started && waitingForInput && !voiceMode.needsRestart) {
      if (!skipChoicePrompt) {
        setVoiceState(VOICE_STATES.AWAITING_INPUT, {
          turnId: sceneState.turnId,
          sceneKey: sceneState.key,
          awaitingInput: true,
          actionCommitted: false,
          pendingChoices: sceneState.message?.choices || [],
          playbackKind: "choice_prompt",
          playbackCompleted: false,
          resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
        });
        setVoiceStatus("Tell me what you want to do.");
        await speakPrompt(buildChoicePrompt(sceneState.message?.choices));
      }

      let actionText = "";
      try {
        actionText = (await listenAndTranscribe("Listening for your action...")).trim();
      } catch (err) {
        setVoiceStatus(err.message || "I couldn't hear you.");
        await speakPrompt("I couldn't hear you. Please try again.");
        continue;
      }

      if (!actionText) {
        setVoiceStatus("I didn't catch that.");
        await speakPrompt("I didn't catch that. Please try again.");
        continue;
      }

      const transcriptLabel = `You said: "${actionText}"`;
      setVoiceState(VOICE_STATES.CONFIRMING_ACTION, {
        awaitingInput: true,
        actionCommitted: false,
        playbackKind: "confirm_prompt",
        playbackCompleted: false,
        resumePolicy: RESUME_POLICIES.REPLAY_CHOICES,
      });
      setVoiceStatus("Confirming your action.", transcriptLabel);
      await speakPrompt(`You said: ${actionText}. Is that correct? Say yes or no.`);

      let confirmationText = "";
      try {
        confirmationText = (await listenAndTranscribe("Listening for yes or no...")).trim();
      } catch (err) {
        setVoiceStatus(err.message || "I couldn't hear the confirmation.", transcriptLabel);
        await speakPrompt("I couldn't hear the confirmation. Let's try again.");
        continue;
      }

      const confirmed = parseConfirmation(confirmationText);
      if (confirmed === true) {
        sendText(actionText);
        return;
      }

      if (confirmed === false) {
        setVoiceStatus("Okay, let's try again.");
        await speakPrompt("Okay, let's try again.");
        continue;
      }

      setVoiceStatus("Please answer yes or no.", transcriptLabel);
      await speakPrompt("Please answer yes or no.");
    }
  }

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText(textInput.value);
    }
  });

  sendBtn.addEventListener("click", () => sendText(textInput.value));

  micBtn.addEventListener("mousedown", startRecording);
  micBtn.addEventListener("mouseup", stopRecording);
  micBtn.addEventListener("mouseleave", stopRecording);
  micBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    startRecording();
  });
  micBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    stopRecording();
  });

  newStoryBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendJSON({ type: "new_story" });
    }
  });

  voiceModeBtn.addEventListener("click", () => {
    voiceMode.open = true;
    syncVoiceModeUI();
  });

  voiceModeActionBtn.addEventListener("click", () => {
    if (!voiceMode.started || voiceMode.needsRestart) {
      startVoiceMode();
    }
  });

  voiceModeExitBtn.addEventListener("click", () => {
    stopVoiceMode();
  });

  reconnectBtn.addEventListener("click", connect);
  authBtn.addEventListener("click", () => {
    password = authInput.value;
    connect();
  });
  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authBtn.click();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && (voiceMode.started || voiceMode.armed)) {
      rememberVoiceResume();
    }
  });

  window.addEventListener("pagehide", () => {
    if (voiceMode.started || voiceMode.armed) {
      markVoiceModeForRestart();
    }
  });

  clearLegacyClientAudioCaches();
  syncVoiceModeUI();
  if (voiceMode.needsRestart) {
    setVoiceStatus("Voice mode paused. Restart when you are ready.");
  } else {
    setVoiceStatus("Waiting to start.");
  }

  connect();
})();
