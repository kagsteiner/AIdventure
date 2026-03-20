/**
 * AIdventure — Web Client
 *
 * Connects to the game server via WebSocket, renders the narrative,
 * handles push-to-talk recording, and per-block audio playback.
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
  const newStoryBtn = document.getElementById("new-story-btn");
  const narrativeArea = document.getElementById("narrative-area");
  const narrativeContent = document.getElementById("narrative-content");
  const menuArea = document.getElementById("menu-area");
  const thinkingEl = document.getElementById("thinking-indicator");
  const inputControls = document.getElementById("input-controls");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-btn");

  let ws = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let waitingForInput = false;
  let password = "";
  let currentBlobUrl = null;

  const readySound = new Audio("sound/sound.mp3");
  const narrationAudio = new Audio();

  readySound.preload = "auto";
  narrationAudio.preload = "auto";
  narrationAudio.playsInline = true;

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
    };

    ws.onclose = (e) => {
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
        renderScene(msg);
        playReadySound();
        break;

      case "replay":
        appendSessionDivider();
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
        stopAudio();
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
        renderMenu(msg.items, msg.audio);
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
        break;
    }
  }

  function stopAudio() {
    narrationAudio.pause();
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
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
    }
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
    stopAudio();
    appendPlayerAction(trimmed);
    sendJSON({ type: "text", text: trimmed });
    textInput.value = "";
    disableInput();
  }

  function sendAudio(base64) {
    if (!waitingForInput) return;
    waitingForInput = false;
    stopAudio();
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
