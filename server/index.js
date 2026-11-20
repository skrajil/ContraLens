const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const crypto = require('crypto');
const pdf = require('pdf-extraction');
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');
const { QdrantClient } = require('@qdrant/js-client-rest');

// 1. Load environment variables FIRST
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 2. Initialize AI, Supabase & Qdrant Clients
const cleanKey = (str) => (str || '').replace(/['"]/g, '').trim();

const ai = new GoogleGenAI({ apiKey: cleanKey(process.env.GEMINI_API_KEY) });

const supabase = createClient(
  cleanKey(process.env.SUPABASE_URL),
  cleanKey(process.env.SUPABASE_KEY)
);

const qdrant = new QdrantClient({
  url: cleanKey(process.env.QDRANT_URL),
  apiKey: cleanKey(process.env.QDRANT_API_KEY),
});

const COLLECTION_NAME = 'document_chunks';

// Deduplicates simultaneous risk-audit requests for the same document
const inFlightAnalyses = new Map();

// Ensure Qdrant collection exists with 768-dim Cosine vectors & document_id index
async function ensureQdrantCollection(vectorSize = 768) {
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION_NAME);

  if (!exists) {
    console.log(`Creating Qdrant collection: ${COLLECTION_NAME} (${vectorSize} dims)...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
    });

    console.log(`Creating Payload Index for document_id...`);
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'document_id',
      field_schema: 'keyword',
    });
  }
}

// Configure Multer for in-memory PDF uploads (10 MB cap)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Utility: Sliding-Window Chunking
function createChunks(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let startIndex = 0;
  while (startIndex < text.length) {
    chunks.push(text.slice(startIndex, startIndex + chunkSize));
    startIndex += chunkSize - overlap;
  }
  return chunks;
}

// Utility: Safely extract JSON even if a model wraps it in ```json ... ```
function parseAIJson(rawText) {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Model response did not contain a JSON object.');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Utility: Pick highest-risk legal chunks within a character budget
function selectRiskChunks(sortedPoints, maxChars) {
  const riskRegex =
    /(terminat|indemnif|liabilit|intellectual property|ipr|confiden|penalt|liquidated|non-compete|exclusiv|governing law|arbitration|breach|auto-renew|warranty|payment|fee)/gi;

  // Always keep the opening 3 chunks (parties, effective date, scope)
  const intro = sortedPoints.slice(0, 3);
  const rest = sortedPoints
    .slice(3)
    .map((pt) => ({
      pt,
      hits: (pt.payload.text.match(riskRegex) || []).length,
    }))
    .sort((a, b) => b.hits - a.hits)
    .map((item) => item.pt);

  const ordered = [...intro, ...rest];
  let total = 0;
  const chosen = [];

  for (const pt of ordered) {
    const chunkText = `--- CHUNK ${pt.payload.chunk_index ?? '?'} ---\n${pt.payload.text}`;
    if (total + chunkText.length > maxChars && chosen.length > 0) break;
    chosen.push(chunkText);
    total += chunkText.length;
  }

  return chosen.join('\n\n');
}

// Multi-Model Live Fallback Chain (Gemini -> Groq -> OpenRouter)
async function generateWithFallback(fullPrompt, compactPrompt) {
  const groqKey = cleanKey(process.env.GROQ_API_KEY);
  const openRouterKey = cleanKey(process.env.OPENROUTER_API_KEY);

  const providers = [
    {
      name: 'gemini-3.8-flash',
      run: async () => {
        const res = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: fullPrompt,
        });
        return res.text;
      },
    },
    {
      name: 'gemini-3.5-flash-lite',
      run: async () => {
        const res = await ai.models.generateContent({
          model: 'gemini-3.5-flash-lite',
          contents: fullPrompt,
        });
        return res.text;
      },
    },
    {
      name: 'gemini-3.1-flash-lite',
      run: async () => {
        const res = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: fullPrompt,
        });
        return res.text;
      },
    },
    ...(groqKey
      ? [
          {
            name: 'groq/gpt-oss-120b',
            run: async () => {
              const res = await fetch('[https://api.groq.com/openai/v1/chat/completions](https://api.groq.com/openai/v1/chat/completions)', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${groqKey}`,
                },
                body: JSON.stringify({
                  model: 'openai/gpt-oss-120b',
                  messages: [{ role: 'user', content: compactPrompt }],
                }),
              });
              if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
              const data = await res.json();
              return data.choices?.[0]?.message?.content;
            },
          },
        ]
      : []),
    ...(openRouterKey
      ? [
          {
            name: 'openrouter/free',
            run: async () => {
              const res = await fetch('[https://openrouter.ai/api/v1/chat/completions](https://openrouter.ai/api/v1/chat/completions)', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${openRouterKey}`,
                },
                body: JSON.stringify({
                  model: 'openrouter/free',
                  messages: [{ role: 'user', content: fullPrompt }],
                }),
              });
              if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
              const data = await res.json();
              return data.choices?.[0]?.message?.content;
            },
          },
        ]
      : []),
  ];

  for (const provider of providers) {
    try {
      console.log(`⚡ Trying model: ${provider.name}...`);
      const text = await provider.run();
      if (text) {
        console.log(`✅ Answered by: ${provider.name}`);
        return { text, modelUsed: provider.name };
      }
    } catch (err) {
      console.warn(`⚠️ ${provider.name} failed (${err.status || err.message}). Falling back...`);
    }
  }

  const allFailedError = new Error('All live AI providers in the fallback chain are currently busy.');
  allFailedError.status = 503;
  throw allFailedError;
}

// Compute-Once Risk Audit Engine (Caches permanently in Supabase)
async function runAndCacheRiskAudit(id, forceRefresh = false) {
  // 1. Check Supabase cache first (0 AI tokens used)
  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .single();

  if (docError || !doc) {
    const err = new Error('Document not found.');
    err.status = 404;
    throw err;
  }

  if (doc.risk_analysis && !forceRefresh) {
    console.log(`⚡ Serving CACHED Risk Scorecard for [${id}] (0 AI tokens used)`);
    return { document: doc, analysis: doc.risk_analysis, cached: true };
  }

  // 2. Join existing in-flight audit if one is already running for this doc
  if (!forceRefresh && inFlightAnalyses.has(id)) {
    console.log(`⏳ Joining in-flight Risk Scorecard for [${id}]...`);
    return inFlightAnalyses.get(id);
  }

  const jobPromise = (async () => {
    const scrollResult = await qdrant.scroll(COLLECTION_NAME, {
      filter: {
        must: [{ key: 'document_id', match: { value: id } }],
      },
      limit: 100,
      with_payload: true,
    });

    const points = (scrollResult.points || []).sort(
      (a, b) => (a.payload.chunk_index ?? 0) - (b.payload.chunk_index ?? 0)
    );

    if (points.length === 0) {
      const err = new Error('No indexed text chunks found for this document.');
      err.status = 404;
      throw err;
    }

    const fullContext = selectRiskChunks(points, 24000);
    const compactContext = selectRiskChunks(points, 9000);

    const buildAuditPrompt = (context) => `
You are a senior corporate contracts attorney conducting an automated legal risk audit.
Analyze ONLY the contract excerpts below and return a SINGLE valid JSON object.
Do not include markdown commentary or any text outside the JSON object.

REQUIRED JSON SCHEMA:
{
  "riskScore": 0,
  "riskLevel": "Low | Medium | High | Critical",
  "summary": "2-3 sentence executive summary of the agreement and its overall risk balance",
  "metadata": {
    "contractType": "e.g., Development Agreement, NDA, MSA",
    "parties": ["Party 1", "Party 2"],
    "effectiveDate": "Date or 'Not specified'",
    "governingLaw": "Jurisdiction or 'Not specified'"
  },
  "redFlags": [
    {
      "title": "Short risk title",
      "severity": "High | Medium | Low",
      "clause": "Brief quote or reference from the contract",
      "explanation": "1-2 sentences explaining the legal or financial exposure",
      "recommendation": "1 concrete redline or negotiation fix"
    }
  ],
  "keyObligations": [
    "Specific deadline, deliverable, notice period, or payment rule"
  ]
}

RULES:
- Set "riskScore" to an integer from 0 (very safe) to 100 (extremely risky).
- Identify between 3 and 6 concrete redFlags ordered from highest to lowest severity.
- Identify between 3 and 5 keyObligations.
- Base every claim strictly on the text below. If a metadata field is absent, write "Not specified".

CONTRACT EXCERPTS:
${context}
`;

    console.log(`⚖️ Generating Risk Scorecard for [${id}] (${points.length} chunks)...`);
    const { text: rawJson, modelUsed } = await generateWithFallback(
      buildAuditPrompt(fullContext),
      buildAuditPrompt(compactContext)
    );

    const analysis = parseAIJson(rawJson);

    // Safely coerce score to a clamped integer (0-100) even if returned as a string
    const parsedScore = Number(analysis.riskScore);
    const validScore = Number.isFinite(parsedScore)
      ? Math.min(100, Math.max(0, Math.round(parsedScore)))
      : null;
    analysis.riskScore = validScore ?? 0;

    // Persist both full JSON and numeric risk_score in Supabase
    const { error: saveError } = await supabase
      .from('documents')
      .update({
        risk_analysis: analysis,
        risk_score: validScore,
      })
      .eq('id', id);

    if (saveError) {
      console.error('❌ Failed to cache risk analysis:', saveError);
    } else {
      console.log(`💾 Cached Risk Scorecard (${validScore}/100) for [${id}] in Supabase.`);
    }

    return {
      document: { ...doc, risk_score: validScore, risk_analysis: analysis },
      analysis,
      modelUsed,
      cached: false,
    };
  })();

  inFlightAnalyses.set(id, jobPromise);
  jobPromise.finally(() => {
    if (inFlightAnalyses.get(id) === jobPromise) {
      inFlightAnalyses.delete(id);
    }
  });

  return jobPromise;
}

// ==========================================
// API ROUTES
// ==========================================

// 1. Document Upload, Async Embedding & Auto Risk Audit
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const pdfData = await pdf(req.file.buffer);
    const extractedText = (pdfData.text || '').trim();

    if (!extractedText) {
      return res.status(400).json({
        error: 'No selectable text found in this PDF. Scanned-PDF OCR support is coming in Phase 3.',
      });
    }

    const chunks = createChunks(extractedText, 1000, 150);

    // Save initial metadata in Supabase as 'processing'
    const { data: docRecord, error: supabaseError } = await supabase
      .from('documents')
      .insert({
        file_name: req.file.originalname,
        upload_date: new Date(),
        page_count: pdfData.numpages,
        chunk_count: chunks.length,
        status: 'processing',
      })
      .select()
      .single();

    if (supabaseError) throw new Error(`Supabase Error: ${supabaseError.message}`);

    // Respond immediately so the frontend doesn't hang
    res.status(202).json({
      message: 'Upload successful! Processing in background...',
      documentId: docRecord.id,
      status: 'processing',
    });

    // Background embedding + vector upsert + one-time risk audit
    (async () => {
      try {
        console.log(`Starting background processing for ${chunks.length} chunks...`);
        const chunkData = [];

        // Respect Google's 100 RPM Free Tier embedding limit
        for (let i = 0; i < chunks.length; i++) {
          const response = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: chunks[i],
            config: { outputDimensionality: 768 },
          });

          chunkData.push({
            chunkIndex: i,
            text: chunks[i],
            embedding: response.embeddings[0].values,
          });

          await new Promise((resolve) => setTimeout(resolve, 750));
        }

        console.log(`Embeddings generated! Saving to Qdrant...`);

        await ensureQdrantCollection(768);
        const points = chunkData.map((item) => ({
          id: crypto.randomUUID(),
          vector: item.embedding,
          payload: {
            document_id: docRecord.id,
            file_name: req.file.originalname,
            chunk_index: item.chunkIndex,
            text: item.text,
          },
        }));
        await qdrant.upsert(COLLECTION_NAME, { wait: true, points });

        await supabase
          .from('documents')
          .update({ status: 'completed' })
          .eq('id', docRecord.id);

        console.log(`🎉 Background processing complete for ${req.file.originalname}!`);

        // Automatically compute & cache the Risk Scorecard once right after indexing
        runAndCacheRiskAudit(docRecord.id).catch((err) => {
          console.warn(`⚠️ Auto-audit deferred for [${docRecord.id}]:`, err.message);
        });
      } catch (bgError) {
        console.error('Background Processing Failed:', bgError);
        await supabase.from('documents').update({ status: 'failed' }).eq('id', docRecord.id);
      }
    })();
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Poll Single Document Processing Status
app.get('/api/documents/status/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('status')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Document not found' });
  res.json({ status: data.status });
});

// 3. Semantic RAG Question-Answering
app.post('/api/documents/ask', async (req, res) => {
  try {
    const { documentId, question } = req.body;

    if (!documentId || !question) {
      return res.status(400).json({ error: 'Missing documentId or question.' });
    }

    console.log(`Analyzing Document [${documentId}] for question: "${question}"`);

    // Convert question into a 768-dim vector (must match upload embedding model)
    const queryResponse = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: question,
      config: { outputDimensionality: 768 },
    });
    const queryVector = queryResponse.embeddings[0].values;

    // Search Qdrant for Top 10 relevant chunks for this contract
    const qdrantResponse = await qdrant.query(COLLECTION_NAME, {
      query: queryVector,
      filter: {
        must: [{ key: 'document_id', match: { value: documentId } }],
      },
      limit: 10,
      score_threshold: 0.5,
      with_payload: true,
    });

    const searchResults = qdrantResponse.points || qdrantResponse;

    if (searchResults.length === 0) {
      return res.json({
        answer: "I couldn't find any relevant information in this document.",
        sources: [],
      });
    }

    const fullContext = searchResults
      .map((hit, index) => `--- CHUNK ${hit.payload.chunk_index ?? index + 1} ---\n${hit.payload.text}`)
      .join('\n\n');

    const compactContext = searchResults
      .slice(0, 6)
      .map((hit, index) => `--- CHUNK ${hit.payload.chunk_index ?? index + 1} ---\n${hit.payload.text}`)
      .join('\n\n');

    const buildPrompt = (context) => `
You are an elite corporate legal analyst.
Using ONLY the following document chunks, answer the user's question.
If the answer is not contained in the chunks, you must reply exactly with: "The provided document does not contain this information."

CRITICAL FORMATTING RULES:
- ALWAYS format your answer using clear bullet points.
- Be highly specific and cite the exact conditions or rules from the text.
- Do not use markdown headers (##), only bold text and bullet points.

Context Chunks:
${context}

Question: ${question}
`;

    console.log(`Sending ${searchResults.length} chunks through fallback chain...`);
    const { text: answerText, modelUsed } = await generateWithFallback(
      buildPrompt(fullContext),
      buildPrompt(compactContext)
    );

    const sources = searchResults.map((match) => ({
      chunkIndex: match.payload.chunk_index,
      score: match.score,
    }));

    res.json({
      answer: answerText,
      modelUsed,
      sources,
    });
  } catch (error) {
    console.error('Retrieval Error:', error);

    if (error.status === 503 || error.status === 429) {
      return res.status(503).json({
        error: 'All free-tier AI models are currently busy. Please wait 15 seconds and click Send again.',
      });
    }

    res.status(500).json({ error: 'Failed to query document' });
  }
});

// 4. List All Uploaded Documents (Newest First)
app.get('/api/documents', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('upload_date', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Fetch Documents Error:', error);
    res.status(500).json({ error: 'Failed to load documents.' });
  }
});

// 5. Get or Generate Cached Legal Risk Scorecard
app.get('/api/documents/:id/analysis', async (req, res) => {
  try {
    const result = await runAndCacheRiskAudit(req.params.id, req.query.refresh === 'true');
    res.json(result);
  } catch (error) {
    console.error('Risk Analysis Error:', error);
    if (error.status === 404) {
      return res.status(404).json({ error: error.message });
    }
    if (error.status === 503 || error.status === 429) {
      return res.status(503).json({
        error: 'All free-tier AI models are currently busy. Click Retry Audit in a few seconds.',
      });
    }
    res.status(500).json({ error: 'Failed to generate contract risk scorecard.' });
  }
});

// 6. Delete Document from Both Qdrant and Supabase
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await qdrant.delete(COLLECTION_NAME, {
      filter: {
        must: [{ key: 'document_id', match: { value: id } }],
      },
    });

    const { error } = await supabase.from('documents').delete().eq('id', id);
    if (error) throw error;

    console.log(`🗑️ Deleted document [${id}] from Qdrant and Supabase.`);
    res.json({ message: 'Document deleted successfully.' });
  } catch (error) {
    console.error('Delete Document Error:', error);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// Start Server & Clean Up Interrupted Jobs
app.listen(PORT, async () => {
  console.log(`🚀 ContraLens Server running on port ${PORT}`);

  const { error } = await supabase
    .from('documents')
    .update({ status: 'failed' })
    .ilike('status', 'processing');

  if (error) console.error('Startup cleanup error:', error);
});