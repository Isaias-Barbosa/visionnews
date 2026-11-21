
const API_FREE_URL = "https://api-free.deepl.com/v2/translate";
const API_PRO_URL = "https://api.deepl.com/v2/translate";

const MAX_TEXTS = 500;
const MAX_TOTAL_CHARS = 70000;
const MAX_BATCH_ITEMS = 50;
const MAX_BATCH_BYTES = 120 * 1024;
const MAX_PART_CHARS = 28000;

const TRANSLATION_CONTEXT =
  "Notícias sobre anime, mangá, jogos e cultura pop japonesa. " +
  "Traduza para português brasileiro natural, preservando nomes próprios, " +
  "títulos oficiais, datas, números e citações.";

function validateInput(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("Nenhum texto foi enviado para tradução.");
  }

  if (texts.length > MAX_TEXTS) {
    throw new Error("A matéria contém trechos demais para traduzir.");
  }

  const ids = new Set();
  let totalChars = 0;

  const normalized = texts.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.text !== "string"
    ) {
      throw new Error("A estrutura dos textos enviados é inválida.");
    }

    if (!item.id || ids.has(item.id)) {
      throw new Error("Foram encontrados identificadores inválidos.");
    }

    ids.add(item.id);
    totalChars += item.text.length;

    return {
      id: item.id,
      text: item.text,
    };
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw new Error(
      "O conteúdo ultrapassa o limite de tradução por matéria.",
    );
  }

  return normalized;
}

// Divide textos muito grandes sem perder caracteres ou espaços.
function splitText(text) {
  if (!text) return [""];

  const parts = [];
  let remaining = text;

  while (remaining.length > MAX_PART_CHARS) {
    let cut = MAX_PART_CHARS;

    // Procura um espaço próximo ao limite para evitar cortar palavras.
    const searchStart = Math.floor(MAX_PART_CHARS * 0.8);
    const boundary = remaining.lastIndexOf(" ", MAX_PART_CHARS);

    if (boundary > searchStart) {
      cut = boundary + 1;
    }

    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }

  if (remaining) parts.push(remaining);

  return parts;
}

function prepareBatches(texts) {
  const parts = [];

  for (const item of texts) {
    const chunks = splitText(item.text);

    for (const text of chunks) {
      parts.push({
        id: item.id,
        text,
      });
    }
  }

  const batches = [];
  let current = [];

  for (const part of parts) {
    const candidate = [...current, part];

    const body = JSON.stringify({
      text: candidate.map((item) => item.text),
      target_lang: "PT-BR",
      context: TRANSLATION_CONTEXT,
    });

    const size = Buffer.byteLength(body, "utf8");

    if (
      current.length &&
      (candidate.length > MAX_BATCH_ITEMS ||
        size > MAX_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [part];
    } else {
      current = candidate;
    }

    const singleBody = JSON.stringify({
      text: [part.text],
      target_lang: "PT-BR",
      context: TRANSLATION_CONTEXT,
    });

    if (Buffer.byteLength(singleBody, "utf8") > MAX_BATCH_BYTES) {
      throw new Error(
        "Um trecho ultrapassa o limite de tamanho aceito pelo DeepL.",
      );
    }
  }

  if (current.length) batches.push(current);

  return batches;
}

function getApiUrl(apiKey) {
  return apiKey.trim().endsWith(":fx")
    ? API_FREE_URL
    : API_PRO_URL;
}

function getApiKey(env) {
  return (
    env.DEEPL_API_KEY ||
    env.DEEPL_AUTH_KEY ||
    ""
  ).trim();
}

async function translateBatch(batch, apiKey, apiUrl) {
  let response;

  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: batch.map((item) => item.text),
        target_lang: "PT-BR",
        context: TRANSLATION_CONTEXT,
        preserve_formatting: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    if (
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
    ) {
      throw new Error(
        "A tradução demorou demais. Tente novamente.",
      );
    }

    throw new Error(
      "Não foi possível conectar à API do DeepL.",
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "O DeepL retornou uma resposta inválida.",
    );
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 401) {
      throw new Error(
        "A chave do DeepL é inválida ou não tem permissão.",
      );
    }

    if (response.status === 456) {
      throw new Error(
        "A cota mensal de tradução do DeepL foi atingida.",
      );
    }

    if (response.status === 429) {
      throw new Error(
        "O limite de requisições do DeepL foi atingido. Aguarde e tente novamente.",
      );
    }

    if (response.status >= 500) {
      throw new Error(
        "O serviço do DeepL está temporariamente indisponível.",
      );
    }

    throw new Error(
      `Erro do DeepL (${response.status}). Verifique os parâmetros da tradução.`,
    );
  }

  if (
    !Array.isArray(data?.translations) ||
    data.translations.length !== batch.length
  ) {
    throw new Error(
      "O DeepL não retornou todos os trechos traduzidos.",
    );
  }

  return data.translations.map((item) => {
    if (typeof item?.text !== "string") {
      throw new Error(
        "O DeepL retornou um trecho de tradução inválido.",
      );
    }

    return item.text;
  });
}

/**
 * Traduz trechos para português brasileiro utilizando DeepL API.
 *
 * A função:
 * - Detecta automaticamente o idioma de origem.
 * - Traduz para PT-BR.
 * - Divide os textos em lotes compatíveis com a API.
 * - Mantém os identificadores originais.
 * - Não altera o banco de dados.
 */
export async function translateTexts(texts, env = process.env) {
  const apiKey = getApiKey(env);

  if (!apiKey) {
    throw new Error(
      "Configure DEEPL_API_KEY ou DEEPL_AUTH_KEY no servidor.",
    );
  }

  const input = validateInput(texts);
  const batches = prepareBatches(input);
  const apiUrl = getApiUrl(apiKey);

  const translatedParts = new Map(
    input.map((item) => [item.id, []]),
  );

  // Chamadas sequenciais para respeitar os limites do provedor.
  for (const batch of batches) {
    const results = await translateBatch(
      batch,
      apiKey,
      apiUrl,
    );

    batch.forEach((item, index) => {
      translatedParts.get(item.id).push(results[index]);
    });
  }

  return input.map((item) => ({
    id: item.id,
    text: translatedParts.get(item.id).join(""),
  }));
}
