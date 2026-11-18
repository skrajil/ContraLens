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

// 2. Initialize Gemini SDK
const cleanKey = (str) => (str || '').replace(/['"]/g, '').trim();
const ai = new GoogleGenAI({ apiKey: cleanKey(process.env.GEMINI_API_KEY) });

// 3. Initialize Supabase & Qdrant Clients
const supabase = createClient(
  cleanKey(process.env.SUPABASE_URL),
  cleanKey(process.env.SUPABASE_KEY)
);

const qdrant = new QdrantClient({
  url: cleanKey(process.env.QDRANT_URL),
  apiKey: cleanKey(process.env.QDRANT_API_KEY)
});

const COLLECTION_NAME = 'document_chunks';

// Ensure Qdrant collection exists with 768-dim Cosine vectors
async function ensureQdrantCollection(vectorSize = 768) {
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION_NAME);

  if (!exists) {
    console.log(`Creating Qdrant collection: ${COLLECTION_NAME} (${vectorSize} dims)...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine'
      }
    });
    // Create a Payload Index so Qdrant allows us to filter by document_id
    console.log(`Creating Payload Index for document_id...`);
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'document_id',
      field_schema: 'keyword' 
    });
  }
}

// Configure Multer for in-memory PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Utility: Sliding-Window Chunking
function createChunks(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let startIndex = 0;
  while (startIndex < text.length) {
    chunks.push(text.slice(startIndex, startIndex + chunkSize));
    startIndex += (chunkSize - overlap);
  }
  return chunks;
}

async function generateWithFallback(fullPrompt, compactPrompt) {
  // 1. Define your live fallback chain in priority order
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
    // Cross-provider fallback 1: Groq (only runs if GROQ_API_KEY is in .env)
    ...(process.env.GROQ_API_KEY
      ? [
          {
            name: 'groq/gpt-oss-120b',
            run: async () => {
              const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'openai/gpt-oss-120b',
                  messages: [{ role: 'user', content: compactPrompt }], // Top 6 chunks to stay under 8K TPM
                }),
              });
              if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
              const data = await res.json();
              return data.choices[0].message.content;
            },
          },
        ]
      : []),
    // Cross-provider fallback 2: OpenRouter Free Router (only runs if OPENROUTER_API_KEY is in .env)
    ...(process.env.OPENROUTER_API_KEY
      ? [
          {
            name: 'openrouter/free',
            run: async () => {
              const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                },
                body: JSON.stringify({
                  model: 'openrouter/free',
                  messages: [{ role: 'user', content: fullPrompt }],
                }),
              });
              if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
              const data = await res.json();
              return data.choices[0].message.content;
            },
          },
        ]
      : []),
  ];

  // 2. Cascade through providers until one succeeds
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

  throw new Error('All live AI providers in the fallback chain are currently unavailable.');
}

// Document Upload, Embedding & Dual-Database Persistence Endpoint
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const pdfData = await pdf(req.file.buffer);
    const extractedText = pdfData.text.trim();
    const chunks = createChunks(extractedText, 1000, 150); // Keep your high accuracy chunks!

    // 1. Instantly save the document to Supabase as 'processing'
    const { data: docRecord, error: supabaseError } = await supabase
      .from('documents')
      .insert({
        file_name: req.file.originalname,
        page_count: pdfData.numpages,
        chunk_count: chunks.length,
        status: 'processing' // <--- Note the status
      })
      .select().single();

    if (supabaseError) throw new Error(`Supabase Error: ${supabaseError.message}`);

    // 2. INSTANTLY RESPOND TO THE USER (UX is saved! Takes 0.5 seconds)
    res.status(202).json({
      message: 'Upload successful! Processing in background...',
      documentId: docRecord.id,
      status: 'processing'
    });

    // 3. ASYNCHRONOUS BACKGROUND PROCESS (Runs after response is sent)
    // We wrap this in an async IIFE so it doesn't block the server
    (async () => {
      try {
        console.log(`Starting background processing for ${chunks.length} chunks...`);
        const chunkData = [];

        // Process sequentially to perfectly respect Google's 100/minute free tier limit
        for (let i = 0; i < chunks.length; i++) {
          const response = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: chunks[i],
            config: { outputDimensionality: 768 }
          });

          chunkData.push({
            chunkIndex: i,
            text: chunks[i],
            embedding: response.embeddings[0].values
          });

          // 750ms delay ensures we never hit the 429 Rate Limit error
          await new Promise(resolve => setTimeout(resolve, 750));
        }

        console.log(`Embeddings generated! Saving to Qdrant...`);

        // 4. Save to Qdrant
        await ensureQdrantCollection(768);
        const points = chunkData.map((item) => ({
          id: crypto.randomUUID(),
          vector: item.embedding,
          payload: {
            document_id: docRecord.id,
            file_name: req.file.originalname,
            chunk_index: item.chunkIndex,
            text: item.text
          }
        }));
        await qdrant.upsert(COLLECTION_NAME, { wait: true, points });

        // 5. Update Supabase to completed
        await supabase
          .from('documents')
          .update({ status: 'completed' })
          .eq('id', docRecord.id);

        console.log(`🎉 Background processing complete for ${req.file.originalname}!`);
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

app.get('/api/documents/status/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('status')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Document not found' });
  res.json({ status: data.status }); // Returns 'processing', 'completed', or 'failed'
});

// Semantic Search & Risk Analysis Endpoint
app.post('/api/documents/ask', async (req, res) => {
  try {
    const { documentId, question } = req.body;

    if (!documentId || !question) {
      return res.status(400).json({ error: 'Missing documentId or question.' });
    }

    console.log(`Analyzing Document [${documentId}] for question: "${question}"`);

    // 1. Convert the user's question into a 768-dimension vector (KEEP gemini-embedding-001!)
    const queryResponse = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: question,
      config: { outputDimensionality: 768 },
    });
    const queryVector = queryResponse.embeddings[0].values;

    // 2. Search Qdrant for the Top 15 most relevant chunks from THIS specific document
    const qdrantResponse = await qdrant.query(COLLECTION_NAME, {
      query: queryVector,
      filter: {
        must: [{ key: 'document_id', match: { value: documentId } }],
      },
      limit: 10,
      score_threshold: 0.50,
      with_payload: true,
    });

    const searchResults = qdrantResponse.points || qdrantResponse;

    if (searchResults.length === 0) {
      return res.json({
        answer: "I couldn't find any relevant information in this document.",
        sources: [],
      });
    }

    // 3. Build both full context (10 chunks) and compact context (6 chunks for Groq)
    const fullContext = searchResults
      .map((hit, index) => `--- CHUNK ${hit.payload.chunk_index ?? index + 1} ---\n${hit.payload.text}`)
      .join('\n\n');

    const compactContext = searchResults
      .slice(0, 6)
      .map((hit, index) => `--- CHUNK ${hit.payload.chunk_index ?? index + 1} ---\n${hit.payload.text}`)
      .join('\n\n');

    // 4. Prompt builder with strict legal formatting rules
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

    // 5. Generate the Final Answer using the Multi-Model Fallback Chain
    console.log(`Sending ${searchResults.length} chunks through fallback chain...`);
    const { text: answerText, modelUsed } = await generateWithFallback(
      buildPrompt(fullContext),
      buildPrompt(compactContext)
    );

    // 6. Format and send the response back to React
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


app.listen(PORT, () => {
  console.log(`🚀 ContraLens Server running on port ${PORT}`);
});