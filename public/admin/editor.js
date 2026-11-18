
(function () {
  const box = document.getElementById("richEditor");
  let selection = null;
  let imageJob = null;
  let importedStyle = null;
  let fontCatalogReady = false;
  let fontCategory = "all";

  const styleStatus = document.getElementById("styleStatus");

  function hint(message) {
    if (!styleStatus) return;
    styleStatus.textContent = message || "";
    if (message) {
      clearTimeout(hint.timer);
      hint.timer = setTimeout(() => {
        styleStatus.textContent = "";
      }, 4000);
    }
  }

  // ---------------------------------------------------------------------------
  // Leitura do DOM -> documento estruturado
  // ---------------------------------------------------------------------------

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

    if (["B", "STRONG"].includes(node.tagName) || node.dataset?.visionBold)
      next.bold = true;
    if (["I", "EM"].includes(node.tagName) || node.dataset?.visionItalic)
      next.italic = true;
    if (node.tagName === "U" || node.dataset?.visionUnderline)
      next.underline = true;
    if (
      ["S", "STRIKE", "DEL"].includes(node.tagName) ||
      node.dataset?.visionStrike
    )
      next.strike = true;

    if (node.tagName === "A") {
      const href = VisionContent.https(node.getAttribute("href"));
      if (href) next.href = href;
    }

    const style = node.style;

    if (style?.fontFamily) {
      next.font = VisionContent.fontFamily(style.fontFamily);
    } else if (node.tagName === "FONT" && node.getAttribute("face")) {
      next.font = VisionContent.fontFamily(node.getAttribute("face"));
    }

    if (style?.fontSize) next.size = VisionContent.fontSize(style.fontSize);

    if (style?.color) {
      next.color = VisionContent.color(style.color);
    } else if (node.tagName === "FONT" && node.getAttribute("color")) {
      next.color = VisionContent.color(node.getAttribute("color"));
    }

    if (style?.backgroundColor) {
      next.bg = VisionContent.color(style.backgroundColor);
    } else if (node.tagName === "MARK") {
      next.bg = "#fff3a3";
    }

    for (const key of ["font", "size", "color", "bg"]) {
      if (!next[key]) delete next[key];
    }

    return [...node.childNodes].flatMap((n) => inline(n, next));
  }

  function blockAlign(node) {
    const align = VisionContent.textAlign(
      node.style?.textAlign || node.getAttribute("align") || "",
    );
    return align;
  }

  const blockTags = ["P", "DIV", "H2", "H3", "UL", "OL", "BLOCKQUOTE"];
  const inlineTags = [
    "SPAN",
    "FONT",
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "STRIKE",
    "DEL",
    "A",
  ];
  const styleProps = ["font-family", "font-size", "color", "background-color"];
  const markTags = {
    visionBold: ["B", "STRONG"],
    visionItalic: ["I", "EM"],
    visionUnderline: ["U"],
    visionStrike: ["S", "STRIKE", "DEL"],
  };

  // O navegador costuma envolver blocos inteiros em SPAN/FONT ao aplicar estilo
  // com o conteúdo todo selecionado. Antes de percorrer a árvore, repassamos as
  // marcas para o bloco interno para não perder fonte, cor ou alinhamento.
  function inheritInlineToBlocks(node) {
    node.querySelectorAll(blockTags.join(",")).forEach((block) => {
      styleProps.forEach((prop) => {
        const value = node.style?.getPropertyValue(prop);
        if (value && !block.style.getPropertyValue(prop)) {
          block.style.setProperty(prop, value);
        }
      });

      if (node.tagName === "FONT") {
        const face = node.getAttribute("face");
        const ink = node.getAttribute("color");
        if (face && !block.style.getPropertyValue("font-family"))
          block.style.setProperty("font-family", face);
        if (ink && !block.style.getPropertyValue("color"))
          block.style.setProperty("color", ink);
      }

      Object.entries(markTags).forEach(([mark, tags]) => {
        if (tags.includes(node.tagName)) block.dataset[mark] = "1";
      });
    });
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

      // elemento inline que embrulha um bloco: propaga as marcas e percorre
      // os filhos para preservar alinhamento e estilo do texto interno.
      if (inlineTags.includes(tag) && node.querySelector(blockTags.join(","))) {
        inheritInlineToBlocks(node);
        [...node.childNodes].forEach(visit);
        return;
      }

      if (tag === "UL" || tag === "OL") {
        flush();
        const list = {
          type: tag.toLowerCase(),
          items: [...node.children]
            .filter((n) => n.tagName === "LI")
            .map((n) => inline(n)),
        };
        const align = blockAlign(node);
        if (align) list.align = align;
        blocks.push(list);
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
          const block = {
            type:
              tag === "BLOCKQUOTE"
                ? "quote"
                : tag === "DIV"
                  ? "p"
                  : tag.toLowerCase(),
            children: inline(node),
          };
          const align = blockAlign(node);
          if (align) block.align = align;
          blocks.push(block);
        }

        return;
      }

      pending.push(...inline(node));
    }

    [...box.childNodes].forEach(visit);
    flush();

    const doc = VisionContent.validate({ type: "doc", blocks });
    VisionContent.ensureFonts(doc);
    return doc;
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

    // Necessário para o YouTube identificar a origem do player.
    iframe.referrerPolicy = "strict-origin-when-cross-origin";

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

  // ---------------------------------------------------------------------------
  // Estilos de texto
  // ---------------------------------------------------------------------------

  function wrapSelection(css) {
    box.focus();
    if (selection) restoreSelection();

    const current = window.getSelection();

    if (!current.rangeCount || current.isCollapsed) {
      hint("Selecione um trecho do texto para aplicar o estilo.");
      return false;
    }

    const range = current.getRangeAt(0);
    const span = document.createElement("span");
    span.style.cssText = css;

    try {
      range.surroundContents(span);
    } catch {
      const fragment = range.extractContents();
      span.appendChild(fragment);
      range.insertNode(span);
    }

    const next = document.createRange();
    next.selectNodeContents(span);
    current.removeAllRanges();
    current.addRange(next);
    selection = next.cloneRange();

    box.dispatchEvent(new Event("input", { bubbles: true }));
    count();
    return true;
  }

  function applyStyle(property, value, label) {
    const css = `${property}:${value}`;

    if (wrapSelection(css)) {
      hint(label || "Estilo aplicado.");
      if (property === "font-family") {
        document.getElementById("currentFont").textContent = value.replace(/["']/g, "");
      }
      return true;
    }

    return false;
  }

  function currentFontSize() {
    const current = window.getSelection();
    let node = current?.anchorNode;
    if (node?.nodeType === 3) node = node.parentElement;
    const size = node?.nodeType === 1
      ? VisionContent.fontSize(window.getComputedStyle(node).fontSize)
      : "";
    return size ? parseInt(size, 10) : 17;
  }

  function changeFontSize(delta) {
    const size = Math.min(
      72,
      Math.max(9, currentFontSize() + delta),
    );
    applyStyle("font-size", `${size}px`, `Tamanho: ${size}px`);
  }

  // Seletor de fontes do catálogo do GitHub/Google Fonts.
  const fontToggle = document.getElementById("fontPickerToggle");
  const fontPicker = document.getElementById("fontPicker");
  const fontSearch = document.getElementById("fontSearch");
  const fontOptions = document.getElementById("fontOptions");
  const fontStatus = document.getElementById("fontCatalogStatus");
  const fontCategories = document.getElementById("fontCategories");

  const categoryNames = {
    all: "Todas",
    "sans-serif": "Sem serifa",
    serif: "Com serifa",
    display: "Display",
    handwriting: "Manuscrita",
    monospace: "Monoespaçada",
  };

  function renderFontOptions() {
    if (!window.VisionFonts) return;

    fontOptions.innerHTML = window.VisionFonts.options(fontSearch.value, {
      category: fontCategory,
      limit: 150,
    });

    fontOptions.querySelectorAll("[data-font]").forEach((button) => {
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        const family = button.dataset.font;
        window.VisionFonts.ensure([family]);
        applyStyle("font-family", `"${family}"`, `Fonte: ${family}`);
        closeFontPicker();
      };
    });
  }

  function renderCategories() {
    fontCategories.innerHTML = Object.entries(categoryNames)
      .map(
        ([key, label]) =>
          `<button type="button" data-category="${key}" class="${key === fontCategory ? "selected" : ""}">${label}</button>`,
      )
      .join("");

    fontCategories.querySelectorAll("[data-category]").forEach((button) => {
      button.onclick = () => {
        fontCategory = button.dataset.category;
        renderCategories();
        renderFontOptions();
      };
    });
  }

  async function openFontPicker() {
    fontPicker.hidden = false;
    fontToggle.setAttribute("aria-expanded", "true");

    if (!window.VisionFonts) {
      fontStatus.textContent = "Catálogo indisponível. Recarregue a página.";
      return;
    }

    if (!fontCatalogReady) {
      fontStatus.textContent = "Carregando catálogo de fontes…";
      try {
        const catalog = await window.VisionFonts.load();
        fontCatalogReady = true;
        fontStatus.textContent =
          catalog.count +
          " fontes disponíveis · " +
          (catalog.source || "catálogo local");
        renderCategories();
      } catch (error) {
        fontStatus.textContent = error.message;
        return;
      }
    }

    renderFontOptions();
    window.VisionFonts.preview(fontSearch.value, 30);
    fontSearch.focus();
  }

  function closeFontPicker() {
    fontPicker.hidden = true;
    fontToggle.setAttribute("aria-expanded", "false");
  }

  if (fontToggle) {
    fontToggle.onmousedown = (event) => event.preventDefault();
    fontToggle.onclick = () => {
      if (fontPicker.hidden) openFontPicker();
      else closeFontPicker();
    };

    fontSearch.addEventListener("input", () => {
      renderFontOptions();
      window.VisionFonts.preview(fontSearch.value, 30);
    });
  }

  document.getElementById("fontSizeDown").onclick = () => changeFontSize(-2);
  document.getElementById("fontSizeUp").onclick = () => changeFontSize(2);
  document.getElementById("textColor").oninput = (event) =>
    applyStyle("color", event.target.value, "Cor aplicada.");
  document.getElementById("highlightColor").oninput = (event) =>
    applyStyle("background-color", event.target.value, "Realce aplicado.");

  // ---------------------------------------------------------------------------
  // Estilos detectados em uma fonte RSS ou em HTML colado
  // ---------------------------------------------------------------------------

  const importedPanel = document.getElementById("importedStyle");
  const importedFonts = document.getElementById("importedFonts");
  const importedColors = document.getElementById("importedColors");
  const importedOrigin = document.getElementById("importedStyleOrigin");

  function renderImportedStyle() {
    if (!importedStyle) {
      importedPanel.hidden = true;
      return;
    }

    importedPanel.hidden = false;
    importedOrigin.textContent = importedStyle.origin || "";

    importedFonts.innerHTML = importedStyle.fonts.length
      ? importedStyle.fonts
          .map(
            (font, index) =>
              `<button type="button" class="styleChip fontChip" data-style-font="${index}" style="font-family:'${VisionContent.escape(font)}',serif">${VisionContent.escape(font)}</button>`,
          )
          .join("")
      : '<span class="styleEmpty">Nenhuma fonte detectada</span>';

    importedColors.innerHTML = importedStyle.colors.length
      ? importedStyle.colors
          .map(
            (item, index) =>
              `<button type="button" class="styleChip colorChip" data-style-color="${index}" title="${VisionContent.escape(item)}"><i style="background:${VisionContent.escape(item)}"></i>${VisionContent.escape(item)}</button>`,
          )
          .join("")
      : '<span class="styleEmpty">Nenhuma cor detectada</span>';

    importedFonts.querySelectorAll("[data-style-font]").forEach((button) => {
      button.onclick = () => {
        const family = importedStyle.fonts[Number(button.dataset.styleFont)];
        window.VisionFonts?.ensure([family]);
        applyStyle("font-family", `"${family}"`, `Fonte ${family} aplicada.`);
      };
    });

    importedColors.querySelectorAll("[data-style-color]").forEach((button) => {
      button.onclick = () => {
        const value = importedStyle.colors[Number(button.dataset.styleColor)];
        applyStyle("color", value, "Cor aplicada.");
      };
    });
  }

  function importStyle(style, origin) {
    const normalized = VisionContent.extractStyle(
      typeof style === "string" ? style : "",
    );
    const source = style && typeof style === "object" ? style : normalized;

    importedStyle = {
      fonts: (Array.isArray(source.fonts) ? source.fonts : [])
        .map((item) => VisionContent.fontFamily(item))
        .filter(Boolean)
        .slice(0, 12),
      colors: (Array.isArray(source.colors) ? source.colors : [])
        .map((item) => VisionContent.color(item))
        .filter(Boolean)
        .slice(0, 16),
      backgrounds: (Array.isArray(source.backgrounds) ? source.backgrounds : [])
        .map((item) => VisionContent.color(item))
        .filter(Boolean)
        .slice(0, 12),
      origin: String(origin || "").slice(0, 120),
    };

    renderImportedStyle();
    window.VisionFonts?.ensure(importedStyle.fonts);
    return importedStyle;
  }

  function applyImportedStyle(all) {
    if (!importedStyle?.fonts.length && !importedStyle?.colors.length) {
      hint("Não há estilo importado para aplicar.");
      return;
    }

    const font = importedStyle.fonts[0]
      ? `"${importedStyle.fonts[0]}"`
      : "";
    const color = importedStyle.colors[0] || "";
    const css = [
      font ? `font-family:${font}` : "",
      color ? `color:${color}` : "",
    ]
      .filter(Boolean)
      .join(";");

    if (!css) return;

    if (all) {
      [...box.children].forEach((node) => {
        if (node.classList?.contains("videoEmbed")) return;
        [...node.querySelectorAll("*")]
          .concat(node.nodeType === 1 ? [node] : [])
          .forEach((element) => {
            if (["IFRAME", "SCRIPT", "STYLE", "IMG"].includes(element.tagName)) return;
            if (!element.childNodes.length) return;
            const hasText = [...element.childNodes].some(
              (child) => child.nodeType === 3 && child.textContent.trim(),
            );
            if (!hasText) return;
            element.style.cssText += ";" + css;
          });
      });
      box.dispatchEvent(new Event("input", { bubbles: true }));
      count();
      hint("Estilo aplicado a toda a matéria.");
    } else {
      hint(wrapSelection(css) ? "Estilo aplicado à seleção." : "");
    }

    if (font) window.VisionFonts?.ensure([importedStyle.fonts[0]]);
  }

  document.getElementById("closeImportedStyle").onclick = () => {
    importedStyle = null;
    importedPanel.hidden = true;
  };

  document.getElementById("applyImportedAll").onclick = () =>
    applyImportedStyle(true);
  document.getElementById("applyImportedSelection").onclick = () =>
    applyImportedStyle(false);

  document.getElementById("detectHtmlStyle").onclick = () => {
    const html = document.getElementById("importStyleHtml").value;
    if (!html.trim()) {
      hint("Cole o HTML da notícia para detectar fontes e cores.");
      return;
    }

    importStyle(VisionContent.extractStyle(html), "HTML colado");
    hint("Estilo detectado no HTML.");
  };

  // ---------------------------------------------------------------------------
  // Demais ações do editor
  // ---------------------------------------------------------------------------

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

  document.addEventListener("mousedown", (event) => {
    if (
      !fontPicker.hidden &&
      !fontPicker.contains(event.target) &&
      !fontToggle.contains(event.target)
    ) {
      closeFontPicker();
    }
  });

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
      VisionContent.ensureFonts(doc);
      window.VisionFonts?.ensure(VisionContent.fontFamilies(doc));
      selection = null;
      hideLink();
      hideVideo();
      closeFontPicker();
      count();
    },

    text() {
      if (imageJob) {
        throw Error("Aguarde a imagem terminar de carregar.");
      }

      return VisionContent.plain(documentValue());
    },

    /** Exibe as fontes/cores detectadas em uma notícia importada. */
    importStyle(style, origin) {
      return importStyle(style, origin);
    },
  };
})();
