/**
 * AIdventure — Web Client
 *
 * Connects to the game server via WebSocket, renders the narrative,
 * handles push-to-talk recording, and a ready chime when scenes arrive.
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

  const readySound = new Audio("sound/sound.mp3");
  readySound.preload = "auto";

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
        renderMenu(msg.items);
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

  function renderMenu(items) {
    menuArea.innerHTML = "";
    menuArea.classList.remove("hidden");
    narrativeArea.classList.add("hidden");

    const heading = document.createElement("h2");
    heading.textContent = "Choose Your Adventure";
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
    appendPlayerAction(trimmed);
    sendJSON({ type: "text", text: trimmed });
    textInput.value = "";
    disableInput();
  }

  function sendAudio(base64) {
    if (!waitingForInput) return;
    waitingForInput = false;
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
