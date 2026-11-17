
(function () {
  const box = document.getElementById("richEditor");
  let selection = null;
  let imageJob = null;

  function inline(node, marks = {}) {
    if (node.nodeType === 3) {
      return [{ text: node.textContent, ...marks }];
    }

    if (
      node.nodeType !== 1 ||
      ["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)
    ) {
      return [];
    }

    if (node.tagName === "IMG") {
      return [{ image: node.getAttribute("src") }];
    }

    if (node.tagName === "BR") {
      return [{ text: "\n", ...marks }];
    }

    const next = { ...marks };

    if (["B", "STRONG"].includes(node.tagName)) next.bold = true;
    if (["I", "EM"].includes(node.tagName)) next.italic = true;
    if (node.tagName === "U") next.underline = true;
    if (["S", "STRIKE", "DEL"].includes(node.tagName)) next.strike = true;

    if (node.tagName === "A") {
      const href = VisionContent.https(node.getAttribute("href"));
      if (href) next.href = href;
    }

    return [...node.childNodes].flatMap((n) => inline(n, next));
  }

  function documentValue() {
    const blocks = [];
    let pending = [];

    function flush() {
      if (pending.length) {
        blocks.push({ type: "p", children: pending });
        pending = [];
      }
    }

    function visit(node) {
      if (node.nodeType === 3) {
        pending.push(...inline(node));
        return;
      }

      if (node.nodeType !== 1) return;

      const tag = node.tagName;

      if (["SCRIPT", "STYLE", "OBJECT"].includes(tag)) return;

      // Bloco de vídeo inserido pelo editor.
      if (node.classList.contains("videoEmbed")) {
        const iframe = node.querySelector("iframe");
        const id = iframe
          ? VisionContent.youtubeId(iframe.getAttribute("src"))
          : "";

        if (id) {
          flush();
          blocks.push({ type: "video", id });
        }
        return;
      }

      // Também reconhece iframe válido colado diretamente.
      if (tag === "IFRAME") {
        const id = VisionContent.youtubeId(node.getAttribute("src"));
        if (id) {
          flush();
          blocks.push({ type: "video", id });
        }
        return;
      }

      if (tag === "UL" || tag === "OL") {
        flush();
        blocks.push({
          type: tag.toLowerCase(),
          items: [...node.children]
            .filter((n) => n.tagName === "LI")
            .map((n) => inline(n)),
        });
        return;
      }

      if (["P", "H2", "H3", "BLOCKQUOTE", "DIV"].includes(tag)) {
        flush();

        if (
          [...node.children].some((n) =>
            ["P", "DIV", "H2", "H3", "UL", "OL", "BLOCKQUOTE"].includes(
              n.tagName,
            ),
          )
        ) {
          [...node.childNodes].forEach(visit);
          flush();
        } else {
          blocks.push({
            type:
              tag === "BLOCKQUOTE"
                ? "quote"
                : tag === "DIV"
                  ? "p"
                  : tag.toLowerCase(),
            children: inline(node),
          });
        }

        return;
      }

      pending.push(...inline(node));
    }

    [...box.childNodes].forEach(visit);
    flush();

    return VisionContent.validate({ type: "doc", blocks });
  }

  function count() {
    try {
      const text = VisionContent.plain(documentValue()).trim();
      document.getElementById("wordCount").textContent =
        (text ? text.split(/\s+/).length : 0) +
        " palavras · " +
        text.length +
        " caracteres";
    } catch (error) {
      document.getElementById("wordCount").textContent = error.message;
    }
  }

  function saveSelection() {
    const current = window.getSelection();

    if (
      current.rangeCount &&
      box.contains(current.anchorNode)
    ) {
      selection = current.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    if (!selection) return false;

    if (!box.contains(selection.commonAncestorContainer)) {
      selection = null;
      return false;
    }

    const current = window.getSelection();
    current.removeAllRanges();
    current.addRange(selection);
    return true;
  }

  function command(name, value) {
    box.focus();

    if (selection) restoreSelection();

    const applied = document.execCommand(name, false, value);
    saveSelection();
    box.dispatchEvent(new Event("input", { bubbles: true }));
    count();

    return applied;
  }

  function insertVideo(id) {
    id = VisionContent.youtubeId(id);

    if (!id) {
      throw Error("Não reconheci um vídeo válido do YouTube.");
    }

    box.focus();
    restoreSelection();

    const wrapper = document.createElement("div");
    wrapper.className = "videoEmbed";
    wrapper.contentEditable = "false";
    wrapper.dataset.videoId = id;

    const preview = document.createElement("div");
    preview.className = "videoEmbedPreview";

    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube-nocookie.com/embed/" + id;
    iframe.title = "Vídeo do YouTube";
    iframe.loading = "lazy";
    iframe.allowFullscreen = true;
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    );

    preview.appendChild(iframe);
    wrapper.appendChild(preview);

    const current = window.getSelection();

    if (selection && box.contains(selection.commonAncestorContainer)) {
      current.removeAllRanges();
      current.addRange(selection);
    } else {
      const range = document.createRange();
      range.selectNodeContents(box);
      range.collapse(false);
      current.removeAllRanges();
      current.addRange(range);
    }

    const range = current.getRangeAt(0);
    range.deleteContents();
    range.insertNode(wrapper);

    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    wrapper.after(paragraph);

    const nextRange = document.createRange();
    nextRange.setStart(paragraph, 0);
    nextRange.collapse(true);
    current.removeAllRanges();
    current.addRange(nextRange);

    selection = nextRange.cloneRange();
    box.dispatchEvent(new Event("input", { bubbles: true }));
    count();
  }

  async function compressImage(file) {
    if (
      !/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type) ||
      file.size > 12000000
    ) {
      throw Error(
        "Cole uma imagem PNG, JPEG, WebP, GIF ou BMP de até 12 MB.",
      );
    }

    let bitmap;

    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw Error("Não foi possível abrir essa imagem.");
    }

    try {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: false });

      let scale = Math.min(
        1,
        1400 / Math.max(bitmap.width, bitmap.height),
      );

      for (let attempt = 0; attempt < 5; attempt++) {
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));

        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        const output = canvas.toDataURL("image/jpeg", 0.82);

        if (VisionContent.imageSource(output)) return output;

        scale *= 0.72;
      }

      throw Error("A imagem é grande demais. Tente uma versão menor.");
    } finally {
      bitmap.close();
    }
  }

  box.addEventListener("keyup", saveSelection);
  box.addEventListener("mouseup", saveSelection);
  box.addEventListener("blur", saveSelection);
  box.addEventListener("input", count);

  box.addEventListener("paste", async (event) => {
    event.preventDefault();

    const clipboard = event.clipboardData;
    const file = [...clipboard.files].find((item) =>
      item.type.startsWith("image/"),
    );

    saveSelection();

    if (!file) {
      // Primeiro tenta reconhecer iframe ou link no HTML copiado.
      const html = clipboard.getData("text/html");

      if (html) {
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const iframe = parsed.querySelector("iframe");

        if (iframe) {
          const id = VisionContent.youtubeId(
            iframe.getAttribute("src"),
          );

          if (id) {
            try {
              insertVideo(id);
              document.getElementById("imagePasteStatus").textContent =
                "Vídeo do YouTube inserido.";
              return;
            } catch (error) {
              document.getElementById("imagePasteStatus").textContent =
                error.message;
              return;
            }
          }
        }
      }

      const plainText = clipboard.getData("text/plain").trim();

      // Também aceita iframe copiado como texto.
      if (/<iframe\b/i.test(plainText)) {
        const id = VisionContent.youtubeId(plainText);

        if (id) {
          insertVideo(id);
          document.getElementById("imagePasteStatus").textContent =
            "Vídeo do YouTube inserido.";
          return;
        }
      }

      command("insertText", clipboard.getData("text/plain"));
      return;
    }

    const status = document.getElementById("imagePasteStatus");

    if (imageJob) {
      status.textContent =
        "Aguarde a imagem anterior terminar de carregar.";
      return;
    }

    const job = {};
    imageJob = job;
    const target = selection;

    status.textContent = "Preparando a imagem…";

    try {
      const image = await compressImage(file);
      if (imageJob !== job) return;

      const doc = documentValue();
      doc.blocks.push({ type: "p", children: [{ image }] });
      VisionContent.validate(doc);

      if (
        target &&
        !box.contains(target.commonAncestorContainer)
      ) {
        throw Error("O texto mudou. Cole a imagem novamente.");
      }

      selection = target;

      if (!command("insertImage", image)) {
        throw Error("Clique no texto e tente colar novamente.");
      }

      status.textContent = "Imagem inserida.";
    } catch (error) {
      if (imageJob === job) status.textContent = error.message;
    } finally {
      if (imageJob === job) imageJob = null;
    }
  });

  // Botões de formatação.
  document
    .querySelectorAll("[data-command],[data-block]")
    .forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () =>
        command(
          button.dataset.command || "formatBlock",
          button.dataset.block || null,
        );
    });

  // Links.
  document.getElementById("insertLink").onmousedown = (event) =>
    event.preventDefault();

  const linkFields = document.getElementById("linkFields");
  const editorLink = document.getElementById("editorLink");
  const linkError = document.getElementById("editorLinkError");

  const hideLink = () => {
    linkFields.hidden = true;
    linkError.textContent = "";
  };

  document.getElementById("insertLink").onclick = () => {
    if (!selection || selection.collapsed) {
      linkFields.hidden = false;
      linkError.textContent =
        "Selecione o trecho do texto que vai receber o link.";
      box.focus();
      return;
    }

    linkFields.hidden = false;
    linkError.textContent = "";
    editorLink.value = "";
    editorLink.focus();
  };

  function applyLink() {
    const href = VisionContent.https(editorLink.value.trim());

    if (!href) {
      linkError.textContent = "Informe um endereço HTTPS válido.";
      return;
    }

    if (!selection || selection.collapsed) {
      linkError.textContent = "Selecione um trecho do conteúdo.";
      return;
    }

    hideLink();
    command("createLink", href);
  }

  document.getElementById("applyLink").onclick = applyLink;

  document.getElementById("cancelLink").onclick = () => {
    hideLink();
    box.focus();
  };

  editorLink.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    }

    if (event.key === "Escape") {
      hideLink();
      box.focus();
    }
  });

  // Inserção de vídeo.
  const videoFields = document.getElementById("videoFields");
  const videoInput = document.getElementById("editorVideo");
  const videoError = document.getElementById("editorVideoError");

  function hideVideo() {
    videoFields.hidden = true;
    videoError.textContent = "";
  }

  document.getElementById("insertVideo").onmousedown = (event) =>
    event.preventDefault();

  document.getElementById("insertVideo").onclick = () => {
    saveSelection();
    videoFields.hidden = false;
    videoError.textContent = "";
    videoInput.value = "";
    videoInput.focus();
  };

  document.getElementById("applyVideo").onclick = () => {
    const id = VisionContent.youtubeId(videoInput.value);

    if (!id) {
      videoError.textContent =
        "Cole um link do YouTube ou o código iframe completo.";
      return;
    }

    try {
      insertVideo(id);
      hideVideo();
      document.getElementById("imagePasteStatus").textContent =
        "Vídeo do YouTube inserido.";
    } catch (error) {
      videoError.textContent = error.message;
    }
  };

  document.getElementById("cancelVideo").onclick = () => {
    hideVideo();
    box.focus();
  };

  videoInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("applyVideo").click();
    }

    if (event.key === "Escape") {
      hideVideo();
      box.focus();
    }
  });

  // Ampliar editor.
  const expand = document.getElementById("expandEditor");

  expand.onclick = () => {
    const expanded = box.classList.toggle("richExpanded");
    expand.setAttribute("aria-expanded", String(expanded));
    expand.textContent = expanded
      ? "Reduzir editor"
      : "Ampliar editor";
  };

  window.VisionEditor = {
    get: documentValue,

    set(body, format) {
      imageJob = null;
      document.getElementById("imagePasteStatus").textContent = "";

      let doc;

      try {
        doc =
          format === "rich-v1"
            ? VisionContent.validate(JSON.parse(body))
            : VisionContent.fromPlain(body);
      } catch {
        doc = VisionContent.fromPlain(body);
      }

      box.innerHTML = VisionContent.render(doc);
      selection = null;
      hideLink();
      hideVideo();
      count();
    },

    text() {
      if (imageJob) {
        throw Error("Aguarde a imagem terminar de carregar.");
      }

      return VisionContent.plain(documentValue());
    },
  };
})();
