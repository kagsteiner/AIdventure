/**
 * AIdventure — Web Client
 *
 * Connects to the game server via WebSocket, renders the narrative,
 * text input, optional scene narration (Narrate), and voice preference.
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
  const settingsBtn = document.getElementById("settings-btn");
  const newStoryBtn = document.getElementById("new-story-btn");
  const narrativeArea = document.getElementById("narrative-area");
  const narrativeContent = document.getElementById("narrative-content");
  const menuArea = document.getElementById("menu-area");
  const thinkingEl = document.getElementById("thinking-indicator");
  const inputControls = document.getElementById("input-controls");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-btn");
  const settingsModal = document.getElementById("settings-modal");
  const settingsCloseBtn = document.getElementById("settings-close");
  const ttsVoiceSelect = document.getElementById("tts-voice-select");

  const TTS_VOICE_STORAGE_KEY = "aidventure.tts-voice";
  const DEFAULT_TTS_VOICE = "nova";

  /** Must match server `OPENAI_TTS_VOICES` in engine/ui/web_ui.js */
  const OPENAI_TTS_VOICES = [
    { id: "alloy", label: "Alloy" },
    { id: "ash", label: "Ash" },
    { id: "ballad", label: "Ballad" },
    { id: "coral", label: "Coral" },
    { id: "echo", label: "Echo" },
    { id: "fable", label: "Fable" },
    { id: "nova", label: "Nova" },
    { id: "onyx", label: "Onyx" },
    { id: "sage", label: "Sage" },
    { id: "shimmer", label: "Shimmer" },
    { id: "verse", label: "Verse" },
  ];

  let ws = null;
  let waitingForInput = false;
  let password = "";
  let ttsCounter = 0;
  let currentBlobUrl = null;

  const pendingTts = new Map();
  const readySound = new Audio("sound/sound.mp3");
  const narrationAudio = new Audio();

  readySound.preload = "auto";
  narrationAudio.preload = "auto";
  narrationAudio.playsInline = true;

  function getStoredTtsVoice() {
    try {
      const v = (localStorage.getItem(TTS_VOICE_STORAGE_KEY) || DEFAULT_TTS_VOICE).trim().toLowerCase();
      if (OPENAI_TTS_VOICES.some((o) => o.id === v)) return v;
    } catch {}
    return DEFAULT_TTS_VOICE;
  }

  function setStoredTtsVoice(voice) {
    try {
      localStorage.setItem(TTS_VOICE_STORAGE_KEY, voice);
    } catch {}
  }

  function populateTtsVoiceSelect() {
    ttsVoiceSelect.innerHTML = "";
    for (const { id, label } of OPENAI_TTS_VOICES) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label;
      ttsVoiceSelect.appendChild(opt);
    }
    ttsVoiceSelect.value = getStoredTtsVoice();
  }

  function sendVoicePreference() {
    sendJSON({ type: "voicePreference", voice: getStoredTtsVoice() });
  }

  function openSettings() {
    ttsVoiceSelect.value = getStoredTtsVoice();
    settingsModal.classList.remove("hidden");
    settingsModal.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
    settingsModal.setAttribute("aria-hidden", "true");
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

  /** Same composition as engine/ui/web_ui.js showScene speech text (for TTS cache hits). */
  function buildSceneSpeechText(msg) {
    let t = (msg.narrative || "").trim();
    const choices = msg.choices;
    if (choices && choices.length > 0) {
      t += "\n\n" + choices.map((c, i) => `${i + 1}: ${c}`).join(". ");
    }
    return t;
  }

  function stopNarrationPlayback() {
    narrationAudio.pause();
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
    narrationAudio.removeAttribute("src");
    try {
      narrationAudio.load();
    } catch {}
  }

  function playAudioBase64(base64) {
    if (!base64) return Promise.resolve();
    stopNarrationPlayback();

    const bytes = base64ToBytes(base64);
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    currentBlobUrl = URL.createObjectURL(blob);
    narrationAudio.src = currentBlobUrl;

    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
    }

    return new Promise((resolve, reject) => {
      function cleanupPlayback() {
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = "none";
        }
        stopNarrationPlayback();
      }
      const onEnded = () => {
        narrationAudio.removeEventListener("ended", onEnded);
        narrationAudio.removeEventListener("error", onError);
        cleanupPlayback();
        resolve();
      };
      const onError = () => {
        narrationAudio.removeEventListener("ended", onEnded);
        narrationAudio.removeEventListener("error", onError);
        cleanupPlayback();
        reject(new Error("Audio playback failed."));
      };
      narrationAudio.addEventListener("ended", onEnded);
      narrationAudio.addEventListener("error", onError);
      narrationAudio.play().catch((err) => {
        narrationAudio.removeEventListener("ended", onEnded);
        narrationAudio.removeEventListener("error", onError);
        cleanupPlayback();
        reject(err);
      });
    });
  }

  function requestTts(text) {
    return new Promise((resolve, reject) => {
      const requestId = `tts-${Date.now()}-${++ttsCounter}`;
      const timeoutId = window.setTimeout(() => {
        pendingTts.delete(requestId);
        reject(new Error("Speech generation timed out."));
      }, 60000);

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

  function rejectPendingTts(reason) {
    for (const [, pending] of pendingTts.entries()) {
      pending.reject(reason);
    }
    pendingTts.clear();
  }

  async function startSceneNarration(msg, btn) {
    const text = buildSceneSpeechText(msg);
    if (!text.trim()) return;

    btn.disabled = true;
    try {
      const audio = await requestTts(text);
      if (!audio) {
        appendError("No narration audio returned.");
        return;
      }
      await playAudioBase64(audio);
    } catch (err) {
      appendError(err.message || "Narration failed.");
    } finally {
      btn.disabled = false;
    }
  }

  function connect() {
    connectOverlay.classList.remove("hidden");
    reconnectBtn.classList.add("hidden");
    connectStatus.textContent = "Connecting...";
    gameEl.classList.add("hidden");

    ws = new WebSocket(getWSUrl());

    ws.onopen = () => {
      connectOverlay.classList.add("hidden");
      authOverlay.classList.add("hidden");
      gameEl.classList.remove("hidden");
      narrativeContent.innerHTML = "";
      statusBar.innerHTML = "";
      waitingForInput = false;
      sendVoicePreference();
    };

    ws.onclose = (e) => {
      rejectPendingTts("Connection lost.");
      stopNarrationPlayback();
      if (e.code === 4001) {
        authOverlay.classList.remove("hidden");
        connectOverlay.classList.add("hidden");
        return;
      }
      connectOverlay.classList.remove("hidden");
      gameEl.classList.add("hidden");
      connectStatus.textContent = "Disconnected.";
      reconnectBtn.classList.remove("hidden");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "ttsResult") {
          resolvePendingTts(msg);
          return;
        }
        handleMessage(msg);
      } catch {}
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case "banner":
        appendTextWithAudio("Welcome to AIdventure", msg.audio);
        break;

      case "scene":
        hideThinking();
        stopNarrationPlayback();
        renderScene(msg);
        playReadySound();
        break;

      case "replay":
        appendSessionDivider();
        stopNarrationPlayback();
        renderScene(msg);
        break;

      case "status":
        renderStatus(msg.state);
        newStoryBtn.classList.remove("hidden");
        break;

      case "newStory":
        narrativeContent.innerHTML = "";
        statusBar.innerHTML = "";
        waitingForInput = false;
        stopNarrationPlayback();
        appendTextWithAudio(msg.text, msg.audio);
        break;

      case "thinking":
        showThinking();
        break;

      case "inputRequest":
        waitingForInput = true;
        hideThinking();
        enableInput();
        break;

      case "menu":
        renderMenu(msg.items, msg.heading);
        break;

      case "message":
        appendTextWithAudio(msg.text, msg.audio);
        break;

      case "error":
        appendError(msg.text);
        break;

      case "transcription":
        appendTranscription(msg.text);
        break;

      case "quit":
        appendTextWithAudio(msg.text, msg.audio);
        disableInput();
        stopNarrationPlayback();
        break;
    }
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

    const speechText = buildSceneSpeechText(msg);
    if (speechText.trim()) {
      const row = document.createElement("div");
      row.className = "narrate-row";
      const narrateBtn = document.createElement("button");
      narrateBtn.type = "button";
      narrateBtn.className = "narrate-btn";
      narrateBtn.setAttribute("aria-label", "Narrate this story update");
      narrateBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg> Narrate';
      narrateBtn.addEventListener("click", () => startSceneNarration(msg, narrateBtn));
      row.appendChild(narrateBtn);
      block.appendChild(row);
    }

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

    appendToNarrative(block);
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

  function renderMenu(items, headingText) {
    menuArea.innerHTML = "";
    menuArea.classList.remove("hidden");
    narrativeArea.classList.add("hidden");

    const heading = document.createElement("h2");
    heading.textContent = headingText || "Choose Your Adventure";
    menuArea.appendChild(heading);

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

  function appendTextWithAudio(text, _audio) {
    const hasText = Boolean(text && String(text).trim());
    if (!hasText && !_audio) return;
    const el = document.createElement("div");
    el.className = "narrative-block";
    if (hasText) {
      const p = document.createElement("p");
      p.textContent = String(text).trim();
      el.appendChild(p);
    }
    if (!el.childNodes.length) return;
    appendToNarrative(el);
  }

  function appendSessionDivider() {
    const el = document.createElement("div");
    el.className = "session-divider";
    el.textContent = "↩ Last session";
    appendToNarrative(el);
  }

  function appendError(text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "error-text";
    el.textContent = text;
    appendToNarrative(el);
  }

  function appendTranscription(text) {
    const el = document.createElement("div");
    el.className = "transcription";
    el.textContent = `You said: "${text}"`;
    appendToNarrative(el);
  }

  function appendPlayerAction(text) {
    const el = document.createElement("div");
    el.className = "player-action";
    el.textContent = `> ${text}`;
    appendToNarrative(el);
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

  function appendToNarrative(node) {
    narrativeContent.appendChild(node);
    scrollToBottom();
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
    stopNarrationPlayback();
    appendPlayerAction(trimmed);
    sendJSON({ type: "text", text: trimmed });
    textInput.value = "";
    disableInput();
  }

  function sendAudio(base64) {
    if (!waitingForInput) return;
    waitingForInput = false;
    stopNarrationPlayback();
    sendJSON({ type: "audio", data: base64 });
    disableInput();
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

  populateTtsVoiceSelect();

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText(textInput.value);
    }
  });

  sendBtn.addEventListener("click", () => sendText(textInput.value));

  newStoryBtn.addEventListener("click", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendJSON({ type: "new_story" });
    }
  });

  settingsBtn.addEventListener("click", () => openSettings());
  settingsCloseBtn.addEventListener("click", () => closeSettings());

  ttsVoiceSelect.addEventListener("change", () => {
    const v = ttsVoiceSelect.value;
    if (OPENAI_TTS_VOICES.some((o) => o.id === v)) {
      setStoredTtsVoice(v);
      sendVoicePreference();
    }
  });

  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
      closeSettings();
    }
  });

  reconnectBtn.addEventListener("click", connect);
  authBtn.addEventListener("click", () => {
    password = authInput.value;
    connect();
  });
  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authBtn.click();
  });

  connect();
})();
