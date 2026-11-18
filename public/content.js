
(function (root) {
  const escape = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
    );

  function https(value) {
    try {
      const u = new URL(value);
      return u.protocol === "https:" &&
        !u.username &&
        !u.password &&
        u.href.length <= 2000
        ? u.href
        : "";
    } catch {
      return "";
    }
  }

  function youtubeId(value) {
    const input = String(value || "").trim();
    if (!input || input.length > 3000) return "";

    // Aceita o ID puro.
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

    // Aceita URLs e códigos iframe, mas extrai somente o endereço.
    const match = input.match(
      /(?:src\s*=\s*["']([^"']+)["']|https?:\/\/[^\s"'<>]+)/i,
    );
    const urlValue = match ? match[1] || match[0] : input;

    try {
      const url = new URL(urlValue);
      if (url.protocol !== "https:") return "";

      let id = "";

      if (
        url.hostname === "youtu.be" ||
        url.hostname === "www.youtu.be"
      ) {
        id = url.pathname.split("/").filter(Boolean)[0] || "";
      } else if (
        [
          "youtube.com",
          "www.youtube.com",
          "m.youtube.com",
          "youtube-nocookie.com",
          "www.youtube-nocookie.com",
        ].includes(url.hostname)
      ) {
        if (url.pathname === "/watch") {
          id = url.searchParams.get("v") || "";
        } else {
          const parts = url.pathname.split("/").filter(Boolean);
          if (["embed", "shorts", "live"].includes(parts[0])) {
            id = parts[1] || "";
          }
        }
      }

      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : "";
    } catch {
      return "";
    }
  }

  const maxImageLength = 240000;

  function imageSource(src) {
    if (typeof src !== "string" || src.length > maxImageLength) return "";
    const match =
      /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);

    if (!match || match[2].length % 4 !== 0) return "";

    const header = atob(match[2].slice(0, 16));

    return (
      match[1] === "webp"
        ? header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"
        : header.startsWith("\xff\xd8\xff")
    )
      ? src
      : "";
  }

  // ---------------------------------------------------------------------------
  // Estilos de texto (fonte, tamanho, cor e realce).
  // Valores são normalizados antes de entrarem no documento para que o HTML
  // renderizado nunca dependa de CSS arbitrário vindo de um feed ou da área de
  // transferência.
  // ---------------------------------------------------------------------------

  const genericFamilies = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "inherit",
    "initial",
    "unset",
    "default",
  ]);

  const namedColors = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    yellow: "#ffff00",
    orange: "#ffa500",
    purple: "#800080",
    gray: "#808080",
    grey: "#808080",
    silver: "#c0c0c0",
    lime: "#00ff00",
    navy: "#000080",
    teal: "#008080",
    magenta: "#ff00ff",
    transparent: "",
  };

  function fontFamily(value) {
    const input = String(value ?? "").trim().slice(0, 120);
    if (!input) return "";

    // Remove aspas e declarações de fallback, mantendo apenas o nome da família.
    const family = input
      .split(/,(?![^()]*\))/)[0]
      .replace(/^["']|["']$/g, "")
      .replace(/\\/g, "")
      .trim();

    if (
      !family ||
      family.length > 80 ||
      genericFamilies.has(family.toLowerCase()) ||
      !/^[\p{L}\p{N} ._'&-]+$/u.test(family)
    ) {
      return "";
    }

    return family;
  }

  function color(value) {
    const input = String(value ?? "").trim().slice(0, 60);
    if (!input) return "";

    if (namedColors[input.toLowerCase()] !== undefined) {
      return namedColors[input.toLowerCase()];
    }

    if (/^#[\da-f]{3}$/i.test(input)) {
      return (
        "#" +
        [...input.slice(1)]
          .map((char) => char + char)
          .join("")
          .toLowerCase()
      );
    }

    if (/^#[\da-f]{6}$/i.test(input)) return input.toLowerCase();

    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+)?\s*\)$/i.exec(
      input,
    );

    if (rgb) {
      const parts = rgb.slice(1, 4).map(Number);
      if (parts.some((n) => n > 255)) return "";
      return (
        "#" +
        parts.map((n) => n.toString(16).padStart(2, "0")).join("")
      );
    }

    return "";
  }

  function fontSize(value) {
    const input = String(value ?? "").trim().slice(0, 30);
    const match = /^(\d{1,3}(?:\.\d)?)px$/i.exec(input);
    if (!match) return "";
    const size = Number(match[1]);
    return size >= 8 && size <= 120 ? `${size}px` : "";
  }

  function textAlign(value) {
    const align = String(value ?? "").trim().toLowerCase();
    return ["left", "center", "right", "justify"].includes(align)
      ? align
      : "";
  }

  function listUnique(values, limit) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
      if (result.length >= limit) break;
    }

    return result;
  }

  /**
   * Lê dicas de tipografia de um HTML externo (por exemplo, o conteúdo de um
   * item RSS). Nenhum HTML é preservado: apenas nomes de famílias e cores já
   * normalizados, para que o editor possa oferecê-los como opções editoriais.
   */
  function extractStyle(html) {
    const source = String(html ?? "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .slice(0, 200000);
    if (!source.trim()) return { fonts: [], colors: [], backgrounds: [] };

    const fonts = [];
    const colors = [];
    const backgrounds = [];

    const addFont = (value) => {
      const family = fontFamily(value);
      if (family) fonts.push(family);
    };
    const addColor = (value) => {
      const hex = color(value);
      if (hex) colors.push(hex);
    };
    const addBackground = (value) => {
      const hex = color(value);
      if (hex) backgrounds.push(hex);
    };

    // Links e @import do Google Fonts (a forma mais comum em feeds HTML).
    const googleFonts = /family=([^&"'\s]+)/gi;
    let match;
    while ((match = googleFonts.exec(source))) {
      decodeURIComponent(match[1])
        .split(/\|/)
        .forEach((part) => addFont(part.split(":")[0].replace(/\+/g, " ")));
    }

    // Declarações font-family em <style> ou atributos style. O valor pode vir
    // entre aspas (prática comum em feeds) ou sem aspas.
    const declarations = /font-family\s*:\s*(?:"([^"]+)"|'([^']+)'|([^;}]+))/gi;
    while ((match = declarations.exec(source))) {
      addFont(match[1] || match[2] || match[3]);
    }

    // Atributo face das antigas tags <font>.
    const faces = /\bface\s*=\s*["']([^"']+)["']/gi;
    while ((match = faces.exec(source))) addFont(match[1]);

    const colorDeclarations = /(?:^|[;"'\s])color\s*:\s*([^;"'}]+)/gi;
    while ((match = colorDeclarations.exec(source))) addColor(match[1]);

    const backgroundDeclarations = /background(?:-color)?\s*:\s*([^;"'}]+)/gi;
    while ((match = backgroundDeclarations.exec(source))) {
      addBackground(match[1]);
    }

    const fontColors = /\bcolor\s*=\s*["']([^"']+)["']/gi;
    while ((match = fontColors.exec(source))) addColor(match[1]);

    return {
      fonts: listUnique(fonts, 12),
      colors: listUnique(colors, 16),
      backgrounds: listUnique(backgrounds, 12),
    };
  }

  /** Cria um documento rich a partir de texto com uma estética opcional. */
  function fromPlainStyled(text, style) {
    const doc = fromPlain(text);
    const hint = style && typeof style === "object" ? style : null;
    const font = fontFamily(hint?.fonts?.[0]);
    const ink = color(hint?.colors?.[0]);
    const highlight = color(hint?.backgrounds?.[0]);

    if (font || ink || highlight) {
      doc.blocks.forEach((block) => {
        if (block.type === "video") return;
        const nodes = block.items || block.children;
        nodes.forEach((node) => {
          if (node.image !== undefined) return;
          if (font) node.font = font;
          if (ink) node.color = ink;
          if (highlight) node.bg = highlight;
        });
      });
    }

    return doc;
  }

  function validate(value) {
    let count = 0;
    let length = 0;
    let imageLength = 0;
    const usedFonts = new Set();
    const usedColors = new Set();

    if (
      !value ||
      value.type !== "doc" ||
      !Array.isArray(value.blocks) ||
      value.blocks.length > 1000
    ) {
      throw Error("Documento de texto inválido.");
    }

    const blocks = value.blocks.map((b) => {
      if (!b || typeof b !== "object") {
        throw Error("Bloco de texto inválido.");
      }

      if (b.type === "video") {
        const id = youtubeId(b.id);
        if (!id) throw Error("Vídeo do YouTube inválido.");
        return { type: "video", id };
      }

      if (!["p", "h2", "h3", "quote", "ul", "ol"].includes(b.type)) {
        throw Error("Bloco de texto inválido.");
      }

      function inline(nodes) {
        if (!Array.isArray(nodes) || nodes.length > 2000) {
          throw Error("Texto inválido.");
        }

        return nodes.map((n) => {
          if (++count > 10000 || !n) throw Error("Texto inválido.");

          if (n.image !== undefined) {
            const image = imageSource(n.image);
            if (!image) throw Error("Imagem inválida ou grande demais.");

            imageLength += image.length;

            const maxTotalImageLength = 800000;

            if (imageLength > maxTotalImageLength) {
              throw Error(
                "O conjunto de imagens desta matéria excedeu o limite de 800 KB. Comprima ou reduza algumas imagens."
              );
            }

            return { image };
          }

          if (typeof n.text !== "string") throw Error("Texto inválido.");

          length += n.text.length;
          if (length > 50000) {
            throw Error("O conteúdo deve ter no máximo 50.000 caracteres.");
          }

          const v = { text: n.text };
          if (n.bold === true) v.bold = true;
          if (n.italic === true) v.italic = true;
          if (n.underline === true) v.underline = true;
          if (n.strike === true) v.strike = true;

          if (n.font) {
            v.font = fontFamily(n.font);
            if (!v.font) throw Error("Fonte de texto inválida.");
            usedFonts.add(v.font);
            if (usedFonts.size > 40) throw Error("Muitas fontes neste texto.");
          }

          if (n.size) {
            v.size = fontSize(n.size);
            if (!v.size) throw Error("Tamanho de texto inválido.");
          }

          if (n.color) {
            v.color = color(n.color);
            if (!v.color) throw Error("Cor de texto inválida.");
            usedColors.add(v.color);
          }

          if (n.bg) {
            v.bg = color(n.bg);
            if (!v.bg) throw Error("Cor de realce inválida.");
            usedColors.add(v.bg);
          }

          if (usedColors.size > 200) throw Error("Muitas cores neste texto.");

          if (n.href) {
            v.href = https(n.href);
            if (!v.href) throw Error("Use links HTTPS válidos no conteúdo.");
          }

          return v;
        });
      }

      let result;

      if (b.type === "ul" || b.type === "ol") {
        if (!Array.isArray(b.items) || b.items.length > 500) {
          throw Error("Lista inválida.");
        }

        result = { type: b.type, items: b.items.map(inline) };
      } else {
        result = { type: b.type, children: inline(b.children) };
      }

      if (b.align) {
        result.align = textAlign(b.align);
        if (!result.align) throw Error("Alinhamento inválido.");
      }

      return result;
    });

    return { type: "doc", blocks };
  }

  function plain(doc) {
    doc = validate(doc);

    return doc.blocks
      .map((b) => {
        if (b.type === "video") return "[Vídeo do YouTube]";
        return b.items
          ? b.items.map((a) => a.map((n) => n.text || "").join("")).join("\n")
          : b.children.map((n) => n.text || "").join("");
      })
      .join("\n\n");
  }

  function fromPlain(text) {
    return {
      type: "doc",
      blocks: String(text || "")
        .split(/\n\s*\n/)
        .map((t) => ({ type: "p", children: [{ text: t }] })),
    };
  }

  function inlineStyle(node) {
    const css = [];
    if (node.font) css.push("font-family:&quot;" + escape(node.font) + "&quot;");
    if (node.size) css.push("font-size:" + node.size);
    if (node.color) css.push("color:" + node.color);
    if (node.bg) css.push("background-color:" + node.bg);

    return css.length ? ' style="' + css.join(";") + '"' : "";
  }

  function render(doc) {
    doc = validate(doc);

    function inline(nodes) {
      return nodes
        .map((n) => {
          if (n.image) {
            return (
              '<img class="articleInlineImage" src="' +
              escape(n.image) +
              '" alt="Imagem da matéria" loading="lazy">'
            );
          }

          let s = escape(n.text).replace(/\n/g, "<br>");
          if (n.bold) s = "<strong>" + s + "</strong>";
          if (n.italic) s = "<em>" + s + "</em>";
          if (n.underline) s = "<u>" + s + "</u>";
          if (n.strike) s = "<s>" + s + "</s>";

          const style = inlineStyle(n);
          if (style) s = "<span" + style + ">" + s + "</span>";

          if (n.href) {
            s =
              '<a href="' +
              escape(n.href) +
              '" target="_blank" rel="noopener">' +
              s +
              "</a>";
          }

          return s;
        })
        .join("");
    }

    return doc.blocks
      .map((b) => {
        if (b.type === "video") {
          const src = "https://www.youtube-nocookie.com/embed/" + b.id;
          return (
            '<div class="videoEmbed articleVideoEmbed" contenteditable="false">' +
            '<div class="articleVideoRatio">' +
            '<iframe src="' +
            escape(src) +
            '" title="Vídeo do YouTube" loading="lazy" ' +
            'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ' +
            'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>' +
            "</div></div>"
          );
        }

        const attrs = b.align ? ' style="text-align:' + b.align + '"' : "";

        if (b.items) {
          return (
            "<" +
            b.type +
            attrs +
            ">" +
            b.items.map((a) => "<li>" + inline(a) + "</li>").join("") +
            "</" +
            b.type +
            ">"
          );
        }

        const tag = { quote: "blockquote" }[b.type] || b.type;
        return "<" + tag + attrs + ">" + inline(b.children) + "</" + tag + ">";
      })
      .join("");
  }

  /** Lista as famílias usadas no documento para carregamento sob demanda. */
  function fontFamilies(doc) {
    try {
      const value = validate(doc);
      const families = new Set();

      value.blocks.forEach((block) => {
        const groups = block.items
          ? block.items
          : block.children
            ? [block.children]
            : [];

        groups.forEach((nodes) =>
          nodes.forEach((node) => {
            if (node.font) families.add(node.font);
          }),
        );
      });

      return [...families].slice(0, 30);
    } catch {
      return [];
    }
  }

  function fontHref(doc) {
    const families = fontFamilies(doc);
    if (!families.length) return "";

    const url = new URL("https://fonts.googleapis.com/css2");
    families.forEach((family) => url.searchParams.append("family", family));
    url.searchParams.set("display", "swap");

    return url.href;
  }

  /** Injeta a folha da Google Fonts necessária para exibir o documento. */
  function ensureFonts(doc) {
    if (typeof document === "undefined") return "";

    const href = fontHref(doc);
    if (!href) return "";

    let link = document.getElementById("visionContentFonts");

    if (!link) {
      link = document.createElement("link");
      link.id = "visionContentFonts";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }

    if (link.getAttribute("href") !== href) link.setAttribute("href", href);

    return href;
  }

  root.VisionContent = {
    escape,
    https,
    youtubeId,
    imageSource,
    maxImageLength,
    fontFamily,
    color,
    fontSize,
    textAlign,
    extractStyle,
    fromPlain,
    fromPlainStyled,
    fontFamilies,
    fontHref,
    ensureFonts,
    validate,
    plain,
    render,
  };
})(globalThis);
