/**
 * AIdventure — Web Client
 *
 * Connects to the game server via WebSocket, renders the narrative,
 * handles push-to-talk recording (MediaRecorder) and text input.
 */

(function () {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────

  const authOverlay   = document.getElementById("auth-overlay");
  const authInput     = document.getElementById("auth-input");
  const authBtn       = document.getElementById("auth-btn");
  const connectOverlay = document.getElementById("connect-overlay");
  const connectStatus = document.getElementById("connect-status");
  const reconnectBtn  = document.getElementById("reconnect-btn");
  const gameEl        = document.getElementById("game");
  const statusBar     = document.getElementById("status-bar");
  const narrativeArea = document.getElementById("narrative-area");
  const narrativeContent = document.getElementById("narrative-content");
  const menuArea      = document.getElementById("menu-area");
  const thinkingEl    = document.getElementById("thinking-indicator");
  const inputControls = document.getElementById("input-controls");
  const micBtn        = document.getElementById("mic-btn");
  const textInput     = document.getElementById("text-input");
  const sendBtn       = document.getElementById("send-btn");

  // ── State ─────────────────────────────────────────────

  let ws = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let waitingForInput = false;
  let password = "";

  // ── Connection ────────────────────────────────────────

  function getWSUrl() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Derive base path from the current page so it works behind a reverse proxy
    // e.g. /aidventure/ when served via nginx, or / when running locally
    let basePath = location.pathname;
    if (!basePath.endsWith("/")) {
      basePath = basePath.substring(0, basePath.lastIndexOf("/") + 1);
    }
    let url = `${proto}//${location.host}${basePath}`;
    if (password) url += `?token=${encodeURIComponent(password)}`;
    return url;
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

    ws.onerror = () => {};

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {}
    };
  }

  reconnectBtn.addEventListener("click", connect);
  authBtn.addEventListener("click", () => {
    password = authInput.value;
    connect();
  });
  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authBtn.click();
  });

  // ── Message handlers ──────────────────────────────────

  function handleMessage(msg) {
    switch (msg.type) {
      case "banner":
        playAudio(msg.audio);
        break;

      case "scene":
        hideThinking();
        renderScene(msg);
        playAudio(msg.audio);
        break;

      case "status":
        renderStatus(msg.state);
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
        playAudio(msg.audio);
        break;

      case "message":
        appendText(msg.text);
        playAudio(msg.audio);
        break;

      case "error":
        appendError(msg.text);
        playAudio(msg.audio);
        break;

      case "transcription":
        appendTranscription(msg.text);
        break;

      case "quit":
        appendText(msg.text);
        playAudio(msg.audio);
        disableInput();
        break;
    }
  }

  // ── Rendering ─────────────────────────────────────────

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

    statusBar.innerHTML = parts.map((p) => `<span class="badge">${p}</span>`).join("");
  }

  function renderMenu(items) {
    menuArea.innerHTML = "";
    menuArea.classList.remove("hidden");
    narrativeArea.classList.add("hidden");

    const h = document.createElement("h2");
    h.textContent = "Choose Your Adventure";
    menuArea.appendChild(h);

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

  function appendText(text) {
    if (!text) return;
    const el = document.createElement("div");
    el.className = "narrative-block";
    const p = document.createElement("p");
    p.textContent = text;
    el.appendChild(p);
    narrativeContent.appendChild(el);
    scrollToBottom();
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

  // ── Audio playback (iOS Safari compatible) ────────────
  //
  // iOS Safari blocks audio.play() unless triggered by a user gesture.
  // We reuse ONE Audio element and "unlock" it on the first tap so
  // all subsequent server-driven playback works.

  const persistentAudio = new Audio();
  let audioUnlocked = false;
  let currentBlobUrl = null;
  let pendingAudio = null;

  function unlockAudio() {
    if (audioUnlocked) return;
    // Play + immediately pause to mark this element as user-activated
    persistentAudio.muted = true;
    persistentAudio.play().then(() => {
      persistentAudio.pause();
      persistentAudio.muted = false;
      persistentAudio.currentTime = 0;
      audioUnlocked = true;
      // If audio arrived before the user tapped, play it now
      if (pendingAudio) {
        const b64 = pendingAudio;
        pendingAudio = null;
        playAudio(b64);
      }
    }).catch(() => {});
  }

  document.addEventListener("touchstart", unlockAudio, { passive: true });
  document.addEventListener("click", unlockAudio);

  function playAudio(base64) {
    if (!base64) return;

    // If the audio element hasn't been unlocked yet, queue for later
    if (!audioUnlocked) {
      pendingAudio = base64;
      return;
    }

    stopAudio();

    // Convert base64 to Blob URL (more reliable than data URIs on iOS)
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    currentBlobUrl = URL.createObjectURL(blob);

    persistentAudio.src = currentBlobUrl;
    persistentAudio.play().catch(() => {});
  }

  function stopAudio() {
    persistentAudio.pause();
    persistentAudio.currentTime = 0;
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  }

  // ── Sending actions ───────────────────────────────────

  function sendJSON(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendText(text) {
    if (!text.trim() || !waitingForInput) return;
    waitingForInput = false;
    stopAudio();
    appendPlayerAction(text.trim());
    sendJSON({ type: "text", text: text.trim() });
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

  // ── Text input ────────────────────────────────────────

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendText(textInput.value);
    }
  });

  sendBtn.addEventListener("click", () => sendText(textInput.value));

  // ── Push-to-talk recording ────────────────────────────

  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "";

      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(stream, options);
      recordedChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordedChunks.length === 0) return;

        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(",")[1];
          if (base64) sendAudio(base64);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add("recording");
    } catch (err) {
      appendError("Microphone access denied. Please use text input.");
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    micBtn.classList.remove("recording");
    mediaRecorder.stop();
  }

  // Hold-to-talk: press and hold the mic button
  micBtn.addEventListener("mousedown",  startRecording);
  micBtn.addEventListener("mouseup",    stopRecording);
  micBtn.addEventListener("mouseleave", stopRecording);
  micBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
  micBtn.addEventListener("touchend",   (e) => { e.preventDefault(); stopRecording(); });

  // ── Boot ──────────────────────────────────────────────

  connect();

})();
